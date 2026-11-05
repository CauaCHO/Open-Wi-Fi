import {diagnoseNetwork,evaluatePolicy,forecastCongestion} from "./smartnet-engine.js";

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const id=()=>crypto.randomUUID();
const max=(v,limit)=>String(v??"").trim().slice(0,limit);
const safeNumber=(v,min,maxValue)=>v===null||v===undefined||String(v).trim()===""?null:Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=maxValue?Number(v):null;
const safeInt=(v,min,maxValue)=>{const n=safeNumber(v,min,maxValue);return n!==null&&Number.isInteger(n)?n:null};
const site=env=>env.OPENWIFI_SITE_ID||"openwifi-main";
const isAdmin=session=>["admin","owner"].includes(session?.role);
const isOwner=session=>session?.role==="owner";

async function bodyJson(request){try{return await request.json()}catch{return null}}
async function routerRow(env,routerId){return env.DB.prepare(`SELECT id,site_id,name,enabled,last_seen_at,version FROM router_devices WHERE id=? AND site_id=?`).bind(routerId,site(env)).first()}
async function allowedRouter(env,session,routerId,access,write=false){const row=await routerRow(env,routerId);return row&&await access(env,session,routerId,write)?row:null}
async function list(env,sql,...args){return (await env.DB.prepare(sql).bind(...args).all()).results||[]}

async function overview(env,session,routerId,access){
  const router=await allowedRouter(env,session,routerId,access);
  if(!router)return json({ok:false,error:"router_not_found"},404);
  const cutoff=Date.now()-24*60*60*1000;
  const [telemetry,qoe,aps,dns,cluster,policy]=await Promise.all([
    list(env,`SELECT received_at,cpu_load_pct,free_memory_bytes,total_memory_bytes,uptime_text,hotspot_host_count FROM router_telemetry_samples WHERE site_id=? AND router_id=? AND received_at>=? ORDER BY received_at DESC LIMIT 60`,site(env),routerId,cutoff),
    list(env,`SELECT source,latency_ms,jitter_ms,packet_loss_pct,request_failure_pct,down_kbps,up_kbps,load_ms,captured_at FROM smartnet_qoe_measurements WHERE site_id=? AND router_id=? AND captured_at>=? ORDER BY captured_at DESC LIMIT 60`,site(env),routerId,cutoff),
    list(env,`SELECT a.id AS ap_id,a.name,a.model,s.channel,s.channel_util_pct,s.median_rssi_dbm,s.client_count,s.source,s.captured_at FROM smartnet_access_points a LEFT JOIN smartnet_ap_samples s ON s.ap_id=a.id AND s.minute_bucket=(SELECT MAX(x.minute_bucket) FROM smartnet_ap_samples x WHERE x.ap_id=a.id) WHERE a.site_id=? AND a.router_id=? LIMIT 30`,site(env),routerId),
    list(env,`SELECT resolver,source,latency_ms,success,captured_at FROM smartnet_dns_probes WHERE site_id=? AND router_id=? AND captured_at>=? ORDER BY captured_at DESC LIMIT 60`,site(env),routerId,cutoff),
    list(env,`SELECT m.router_id,m.sector,m.link_down_kbps,m.link_up_kbps,m.weight,m.enabled,r.last_seen_at FROM smartnet_cluster_members m JOIN router_devices r ON r.id=m.router_id AND r.site_id=m.site_id WHERE m.site_id=?`,site(env)),
    env.DB.prepare(`SELECT * FROM smartnet_policies WHERE site_id=? AND router_id=?`).bind(site(env),routerId).first()
  ]);
  const freshTelemetry=telemetry.filter(x=>Date.now()-x.received_at<=5*60*1000);
  const freshQoe=qoe.filter(x=>Date.now()-x.captured_at<=24*60*60*1000);
  const freshAps=aps.filter(x=>x.captured_at&&Date.now()-x.captured_at<=10*60*1000&&x.source!=="manual");
  const freshDns=dns.filter(x=>Date.now()-x.captured_at<=24*60*60*1000);
  const visibleCluster=isAdmin(session)?cluster:cluster.filter(m=>m.router_id===routerId);
  const evaluation=evaluatePolicy({policy,telemetry:freshTelemetry,qoe:freshQoe,apSamples:freshAps,dnsProbes:freshDns,
    clusterMembers:visibleCluster.map(m=>({...m,online:!!m.last_seen_at&&Date.now()-m.last_seen_at<=90000,estimated_load_kbps:null}))});
  return json({ok:true,router,policy:policy||{mode:"observe",profile:"standard",site_down_kbps:0,site_up_kbps:0},
    telemetry:telemetry.slice(0,12),qoe:qoe.slice(0,12),accessPoints:aps,dns:dns.slice(0,12),cluster:visibleCluster,evaluation,
    sources:{telemetry:"RouterOS polling",qoe:"Voluntary browser/agent",ap:"Adapter or manual inventory",dns:"Measured source recorded with each sample"},generatedAt:Date.now()});
}

async function savePolicy(request,env,session,routerId,access){
  if(!isAdmin(session))return json({ok:false,error:"forbidden"},403);
  const router=await allowedRouter(env,session,routerId,access,true);
  if(!router)return json({ok:false,error:"router_not_found"},404);
  const b=await bodyJson(request);if(!b)return json({ok:false,error:"invalid_json"},400);
  const mode=max(b.mode,20),profile=max(b.profile,20);
  const down=safeInt(b.siteDownKbps,0,10000000),up=safeInt(b.siteUpKbps,0,10000000);
  if(!["observe","recommend","automatic"].includes(mode)||!["standard","pcq","fq_codel","cake"].includes(profile)||down===null||up===null)return json({ok:false,error:"invalid_policy"},400);
  const prior=await env.DB.prepare(`SELECT * FROM smartnet_policies WHERE site_id=? AND router_id=?`).bind(site(env),routerId).first();
  if(mode==="automatic")return json({ok:false,error:prior?.verified_at?"automatic_actuator_not_validated":"physical_validation_required"},409);
  const policyId=prior?.id||id(),revision=(prior?.revision||0)+1,now=Date.now();
  const snapshot={mode,profile,siteDownKbps:down,siteUpKbps:up,verifiedAt:prior?.verified_at||null,fasttrackVerified:!!prior?.fasttrack_verified};
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO smartnet_policies(id,site_id,router_id,mode,profile,site_down_kbps,site_up_kbps,revision,verified_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(router_id) DO UPDATE SET mode=excluded.mode,profile=excluded.profile,site_down_kbps=excluded.site_down_kbps,site_up_kbps=excluded.site_up_kbps,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(policyId,site(env),routerId,mode,profile,down,up,revision,prior?.verified_at||null,session.sub,now),
    env.DB.prepare(`INSERT INTO smartnet_policy_versions(policy_id,revision,snapshot_json,actor,reason,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(policyId,revision,JSON.stringify(snapshot),session.sub,max(b.reason,200)||null,now),
    env.DB.prepare(`INSERT INTO smartnet_policy_actions(id,site_id,router_id,policy_id,revision,action,state,before_json,after_json,actor,created_at) VALUES(?,?,?,?,?,'policy_revision','proposed',?,?,?,?)`)
      .bind(id(),site(env),routerId,policyId,revision,prior?JSON.stringify(prior):null,JSON.stringify(snapshot),session.sub,now)
  ]);
  return json({ok:true,policyId,revision,mode,profile,appliedToRouter:false});
}

async function verifyPolicy(request,env,session,routerId,access){
  if(!isOwner(session))return json({ok:false,error:"forbidden"},403);
  const router=await allowedRouter(env,session,routerId,access,true);
  if(!router)return json({ok:false,error:"router_not_found"},404);
  const b=await bodyJson(request);
  if(b?.physicalTestPassed!==true||b.fasttrackChecked!==true||max(b.routerVersion,100)!==String(router.version||""))return json({ok:false,error:"test_evidence_required"},400);
  const now=Date.now();
  const result=await env.DB.prepare(`UPDATE smartnet_policies SET verified_at=?,fasttrack_verified=1,updated_at=?,updated_by=? WHERE site_id=? AND router_id=? AND mode IN ('observe','recommend')`)
    .bind(now,now,session.sub,site(env),routerId).run();
  if(!result.meta?.changes)return json({ok:false,error:"policy_not_found"},404);
  return json({ok:true,verifiedAt:now,automaticEnabled:false});
}

async function rollbackPolicy(request,env,session,routerId,access){
  if(!isOwner(session))return json({ok:false,error:"forbidden"},403);
  if(!await allowedRouter(env,session,routerId,access,true))return json({ok:false,error:"router_not_found"},404);
  const b=await bodyJson(request),revision=safeInt(b?.revision,1,1000000);
  if(revision===null)return json({ok:false,error:"invalid_revision"},400);
  const policy=await env.DB.prepare(`SELECT * FROM smartnet_policies WHERE site_id=? AND router_id=?`).bind(site(env),routerId).first();
  if(!policy)return json({ok:false,error:"policy_not_found"},404);
  const old=await env.DB.prepare(`SELECT snapshot_json FROM smartnet_policy_versions WHERE policy_id=? AND revision=?`).bind(policy.id,revision).first();
  if(!old)return json({ok:false,error:"revision_not_found"},404);
  const snapshot=JSON.parse(old.snapshot_json),now=Date.now(),newRevision=policy.revision+1;
  await env.DB.batch([
    env.DB.prepare(`UPDATE smartnet_policies SET mode='observe',profile=?,site_down_kbps=?,site_up_kbps=?,revision=?,updated_by=?,updated_at=? WHERE id=? AND site_id=?`)
      .bind(snapshot.profile,snapshot.siteDownKbps,snapshot.siteUpKbps,newRevision,session.sub,now,policy.id,site(env)),
    env.DB.prepare(`INSERT INTO smartnet_policy_versions(policy_id,revision,snapshot_json,actor,reason,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(policy.id,newRevision,JSON.stringify({...snapshot,mode:"observe"}),session.sub,`rollback_of_${revision}`,now),
    env.DB.prepare(`INSERT INTO smartnet_policy_actions(id,site_id,router_id,policy_id,revision,action,state,before_json,after_json,actor,created_at) VALUES(?,?,?,?,?,'policy_rollback','rolled_back',?,?,?,?)`)
      .bind(id(),site(env),routerId,policy.id,newRevision,JSON.stringify(policy),JSON.stringify(snapshot),session.sub,now)
  ]);
  return json({ok:true,revision:newRevision,restoredFrom:revision,mode:"observe",appliedToRouter:false});
}

async function saveBrowserQoE(request,env,session,routerId,access){
  if(!await allowedRouter(env,session,routerId,access))return json({ok:false,error:"router_not_found"},404);
  const b=await bodyJson(request);if(!b||b.consent!==true)return json({ok:false,error:"consent_required"},400);
  const latency=safeNumber(b.latencyMs,0,60000),jitter=safeNumber(b.jitterMs,0,60000),loss=safeNumber(b.requestFailurePct,0,100);
  const down=safeInt(b.downKbps,0,10000000),up=safeInt(b.upKbps,0,10000000),load=safeNumber(b.loadMs,0,120000);
  if([latency,jitter,loss].every(x=>x===null)&&down===null&&up===null&&load===null)return json({ok:false,error:"measurement_required"},400);
  const associated=b.routerConnected===true?routerId:null,now=Date.now();
  const recent=await env.DB.prepare(`SELECT MAX(captured_at) AS at FROM smartnet_qoe_measurements WHERE site_id=? AND router_id IS ? AND source='browser_voluntary'`).bind(site(env),associated).first();
  if(recent?.at&&now-recent.at<60000)return json({ok:false,error:"measurement_rate_limited"},429);
  await env.DB.prepare(`INSERT INTO smartnet_qoe_measurements(id,site_id,router_id,source,latency_ms,jitter_ms,request_failure_pct,down_kbps,up_kbps,load_ms,captured_at) VALUES(?,?,?,'browser_voluntary',?,?,?,?,?,?,?)`)
    .bind(id(),site(env),associated,latency,jitter,loss,down,up,load,now).run();
  return json({ok:true,routerAssociated:!!associated,source:"browser_voluntary",packetLossMeasured:false});
}

async function listSite(env,session){
  if(!isAdmin(session))return json({ok:false,error:"forbidden"},403);
  const [aps,cluster,incidents,experiments]=await Promise.all([
    list(env,`SELECT id,router_id,name,vendor,model,management_mode,radio_capable,updated_at FROM smartnet_access_points WHERE site_id=? ORDER BY created_at DESC LIMIT 100`,site(env)),
    list(env,`SELECT m.router_id,m.sector,m.link_down_kbps,m.link_up_kbps,m.weight,m.enabled,r.name,r.last_seen_at FROM smartnet_cluster_members m JOIN router_devices r ON r.id=m.router_id AND r.site_id=m.site_id WHERE m.site_id=?`,site(env)),
    list(env,`SELECT id,router_id,code,severity,confidence_pct,state,opened_at FROM smartnet_incidents WHERE site_id=? ORDER BY opened_at DESC LIMIT 50`,site(env)),
    list(env,`SELECT id,name,state,created_at,updated_at FROM smartnet_experiments WHERE site_id=? ORDER BY created_at DESC LIMIT 30`,site(env))
  ]);
  return json({ok:true,accessPoints:aps,cluster,incidents,experiments,generatedAt:Date.now()});
}

async function saveAp(request,env,session){
  if(!isAdmin(session))return json({ok:false,error:"forbidden"},403);
  const b=await bodyJson(request);if(!b)return json({ok:false,error:"invalid_json"},400);
  const name=max(b.name,80),vendor=max(b.vendor,80),model=max(b.model,80),routerId=max(b.routerId,80)||null;
  if(!name||!model)return json({ok:false,error:"name_and_model_required"},400);
  if(routerId&&!await routerRow(env,routerId))return json({ok:false,error:"router_not_found"},404);
  const now=Date.now(),apId=id();
  await env.DB.prepare(`INSERT INTO smartnet_access_points(id,site_id,router_id,name,vendor,model,management_mode,radio_capable,created_at,updated_at) VALUES(?,?,?,?,?,?,'inventory',0,?,?)`)
    .bind(apId,site(env),routerId,name,vendor||null,model,now,now).run();
  return json({ok:true,id:apId,managementMode:"inventory",telemetryAvailable:false});
}

async function saveClusterMember(request,env,session,routerId,access){
  if(!isAdmin(session))return json({ok:false,error:"forbidden"},403);
  if(!await allowedRouter(env,session,routerId,access,true))return json({ok:false,error:"router_not_found"},404);
  const b=await bodyJson(request);if(!b)return json({ok:false,error:"invalid_json"},400);
  const sector=max(b.sector,80),down=safeInt(b.linkDownKbps,0,10000000),up=safeInt(b.linkUpKbps,0,10000000),weight=safeInt(b.weight,1,100);
  if(!sector||down===null||up===null||weight===null)return json({ok:false,error:"invalid_cluster_member"},400);
  await env.DB.prepare(`INSERT INTO smartnet_cluster_members(router_id,site_id,sector,link_down_kbps,link_up_kbps,weight,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(router_id) DO UPDATE SET sector=excluded.sector,link_down_kbps=excluded.link_down_kbps,link_up_kbps=excluded.link_up_kbps,weight=excluded.weight,updated_at=excluded.updated_at`)
    .bind(routerId,site(env),sector,down,up,weight,Date.now()).run();
  return json({ok:true,routerId,sector,coordinatesNewClientsOnly:true,sessionsMigrated:false});
}

async function saveExperiment(request,env,session){
  if(!isAdmin(session))return json({ok:false,error:"forbidden"},403);
  const b=await bodyJson(request),name=max(b?.name,100),design=b?.design;
  if(!name||!design||typeof design!=="object"||Array.isArray(design)||JSON.stringify(design).length>8000)return json({ok:false,error:"invalid_experiment"},400);
  const now=Date.now(),experimentId=id();
  await env.DB.prepare(`INSERT INTO smartnet_experiments(id,site_id,name,state,design_json,created_by,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?)`)
    .bind(experimentId,site(env),name,JSON.stringify(design),session.sub,now,now).run();
  return json({ok:true,id:experimentId,state:"draft",results:null});
}

async function updateIncident(request,env,session,incidentId){
  if(!isAdmin(session))return json({ok:false,error:"forbidden"},403);
  const b=await bodyJson(request),state=max(b?.state,20);
  if(!["acknowledged","resolved"].includes(state))return json({ok:false,error:"invalid_incident_state"},400);
  const now=Date.now();
  const result=await env.DB.prepare(`UPDATE smartnet_incidents SET state=?,resolved_at=? WHERE id=? AND site_id=?`)
    .bind(state,state==="resolved"?now:null,incidentId,site(env)).run();
  return result.meta?.changes?json({ok:true,state}):json({ok:false,error:"incident_not_found"},404);
}

export async function handleSmartnetAdmin(request,env,session,path,access){
  if(!path.startsWith("/api/admin/smartnet/"))return null;
  const method=request.method;
  if(path==="/api/admin/smartnet/site")return method==="GET"?listSite(env,session):json({ok:false,error:"method_not_allowed"},405);
  if(path==="/api/admin/smartnet/aps"&&method==="POST")return saveAp(request,env,session);
  if(path==="/api/admin/smartnet/experiments"&&method==="POST")return saveExperiment(request,env,session);
  const incident=path.match(/^\/api\/admin\/smartnet\/incidents\/([^/]+)$/);
  if(incident&&method==="PUT")return updateIncident(request,env,session,incident[1]);
  const match=path.match(/^\/api\/admin\/smartnet\/routers\/([^/]+)\/(overview|policy|verify|rollback|qoe|cluster)$/);
  if(!match)return json({ok:false,error:"not_found"},404);
  const [,routerId,action]=match;
  if(action==="overview"&&method==="GET")return overview(env,session,routerId,access);
  if(action==="policy"&&method==="PUT")return savePolicy(request,env,session,routerId,access);
  if(action==="verify"&&method==="POST")return verifyPolicy(request,env,session,routerId,access);
  if(action==="rollback"&&method==="POST")return rollbackPolicy(request,env,session,routerId,access);
  if(action==="qoe"&&method==="POST")return saveBrowserQoE(request,env,session,routerId,access);
  if(action==="cluster"&&method==="PUT")return saveClusterMember(request,env,session,routerId,access);
  return json({ok:false,error:"method_not_allowed"},405);
}

export async function runSmartnetAnalysis(env,now=Date.now()){
  const routers=await list(env,`SELECT id,site_id FROM router_devices WHERE enabled=1 AND last_seen_at>=? ORDER BY last_seen_at DESC LIMIT 50`,now-5*60*1000);
  let opened=0;
  for(const router of routers){
    const [telemetry,qoe,dns]=await Promise.all([
      list(env,`SELECT cpu_load_pct,received_at FROM router_telemetry_samples WHERE router_id=? AND site_id=? AND received_at>=? ORDER BY received_at DESC LIMIT 12`,router.id,router.site_id,now-15*60*1000),
      list(env,`SELECT source,latency_ms,jitter_ms,packet_loss_pct,request_failure_pct,captured_at FROM smartnet_qoe_measurements WHERE router_id=? AND site_id=? AND captured_at>=? ORDER BY captured_at DESC LIMIT 30`,router.id,router.site_id,now-60*60*1000),
      list(env,`SELECT source,latency_ms,success,captured_at FROM smartnet_dns_probes WHERE router_id=? AND site_id=? AND captured_at>=? ORDER BY captured_at DESC LIMIT 30`,router.id,router.site_id,now-60*60*1000)
    ]);
    if(!telemetry.length&&!qoe.length&&!dns.length)continue;
    const diagnosis=diagnoseNetwork({telemetry,qoe,dns});
    const forecast=forecastCongestion(telemetry);
    const issues=[...diagnosis.issues];
    if(forecast.status==="rising")issues.push({code:"predicted_cpu_pressure",severity:"info",confidencePct:forecast.confidencePct,evidence:{predictedCpuPct:forecast.predictedCpuPct,basis:forecast.basis}});
    for(const issue of issues){
      const existing=await env.DB.prepare(`SELECT id FROM smartnet_incidents WHERE site_id=? AND router_id=? AND code=? AND state IN ('open','acknowledged') LIMIT 1`)
        .bind(router.site_id,router.id,issue.code).first();
      if(existing)continue;
      await env.DB.prepare(`INSERT INTO smartnet_incidents(id,site_id,router_id,code,severity,confidence_pct,evidence_json,opened_at) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(id(),router.site_id,router.id,issue.code,issue.severity,issue.confidencePct,JSON.stringify(issue.evidence),now).run();
      opened++;
    }
  }
  return {routersChecked:routers.length,incidentsOpened:opened,actionsApplied:0};
}

export async function pruneSmartnet(env,now=Date.now()){
  const cutoff=now-7*24*60*60*1000;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM smartnet_qoe_measurements WHERE captured_at<?`).bind(cutoff),
    env.DB.prepare(`DELETE FROM smartnet_ap_samples WHERE captured_at<?`).bind(cutoff),
    env.DB.prepare(`DELETE FROM smartnet_dns_probes WHERE captured_at<?`).bind(cutoff)
  ]);
}
