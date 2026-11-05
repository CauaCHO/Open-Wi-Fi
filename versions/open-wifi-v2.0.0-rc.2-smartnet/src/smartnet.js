// Read-only SmartNet observation. Null means the router did not report a value.
const MAX_AGE_MS=3*60*1000;
const RETENTION_MS=7*24*60*60*1000;

function nullableInt(value,min,max){
  if(value===null||value===undefined||value==="")return null;
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>=min&&n<=max?n:null;
}

function memoryBytes(value){
  if(value===null||value===undefined||value==="")return null;
  if(typeof value==="number")return nullableInt(value,0,Number.MAX_SAFE_INTEGER);
  const match=String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB)?$/i);
  if(!match)return null;
  const unit=(match[2]||"B").toLowerCase();
  return nullableInt(Math.round(Number(match[1])*({b:1,kib:1024,mib:1048576,gib:1073741824})[unit]),0,Number.MAX_SAFE_INTEGER);
}

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}

export async function recordRouterTelemetry(env,auth,body,now,hostCount){
  if(auth.legacy||!auth.router?.enabled||!body||typeof body!=="object"||Array.isArray(body))return;
  const siteId=auth.siteId,routerId=auth.routerId;
  const minute=Math.floor(now/60000);
  const cpu=nullableInt(typeof body.cpuLoadPct==="string"?body.cpuLoadPct.replace(/%$/," ").trim():body.cpuLoadPct,0,100);
  const free=memoryBytes(body.freeMemoryBytes);
  const total=memoryBytes(body.totalMemoryBytes);
  const count=nullableInt(hostCount,0,2000);
  const uptime=typeof body.uptime==="string"&&/^[0-9wdhms :]{1,48}$/.test(body.uptime)?body.uptime:null;
  const wanInterface=typeof body.wanInterface==="string"&&/^[A-Za-z0-9._-]{1,64}$/.test(body.wanInterface)?body.wanInterface:null;
  const wanRx=wanInterface?nullableInt(body.wanRxBytes,0,Number.MAX_SAFE_INTEGER):null;
  const wanTx=wanInterface?nullableInt(body.wanTxBytes,0,Number.MAX_SAFE_INTEGER):null;
  if(cpu===null&&free===null&&total===null&&uptime===null)return;
  if(free!==null&&total!==null&&free>total)return;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO router_telemetry_samples
      (site_id,router_id,minute_bucket,received_at,cpu_load_pct,free_memory_bytes,total_memory_bytes,uptime_text,hotspot_host_count,wan_interface,wan_rx_bytes,wan_tx_bytes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(siteId,routerId,minute,now,cpu,free,total,uptime,count,wanInterface,wanRx,wanTx).run();
}

export function withWanRates(samples){
  return samples.map((row,index)=>{
    const older=samples[index+1],elapsed=row.received_at-older?.received_at;
    let down=null,up=null;
    if(row.wan_interface&&row.wan_interface===older?.wan_interface&&elapsed>=30000&&elapsed<=180000&&
      [row.wan_rx_bytes,row.wan_tx_bytes,older.wan_rx_bytes,older.wan_tx_bytes].every(Number.isSafeInteger)){
      const rx=row.wan_rx_bytes-older.wan_rx_bytes,tx=row.wan_tx_bytes-older.wan_tx_bytes;
      if(Number.isSafeInteger(rx)&&rx>=0&&Number.isSafeInteger(tx)&&tx>=0){
        const rxKbps=Math.round(rx*8/elapsed),txKbps=Math.round(tx*8/elapsed);
        if(rxKbps<=10000000&&txKbps<=10000000){down=rxKbps;up=txKbps}
      }
    }
    return {...row,wan_rx_kbps:down,wan_tx_kbps:up};
  });
}

export async function pruneRouterTelemetry(env,now=Date.now()){
  return env.DB.prepare(`DELETE FROM router_telemetry_samples WHERE received_at<?`)
    .bind(now-RETENTION_MS).run();
}

export async function getRouterTelemetry(env,session,routerId,canRead){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const router=await env.DB.prepare(`SELECT id,name,version,last_seen_at,enabled FROM router_devices WHERE id=? AND site_id=?`)
    .bind(routerId,siteId).first();
  if(!router||!await canRead(env,session,routerId))return json({ok:false,error:"router_not_found"},404);
  const rows=await env.DB.prepare(`
    SELECT received_at,cpu_load_pct,free_memory_bytes,total_memory_bytes,uptime_text,hotspot_host_count,wan_interface,wan_rx_bytes,wan_tx_bytes
    FROM router_telemetry_samples WHERE site_id=? AND router_id=? AND received_at>=?
    ORDER BY received_at DESC LIMIT 60
  `).bind(siteId,routerId,Date.now()-RETENTION_MS).all();
  const samples=withWanRates(rows.results||[]);
  const latest=samples[0]||null;
  return json({ok:true,router:{id:router.id,name:router.name,version:router.version},
    latest,fresh:!!latest&&Date.now()-latest.received_at<=MAX_AGE_MS,
    samples,source:"RouterOS / polling HTTPS",generatedAt:Date.now(),maxAgeMs:MAX_AGE_MS});
}
