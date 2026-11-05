// Pure decision support. No network command is executed here.
const finite=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>typeof n==="number"&&Number.isFinite(n)&&n>=min&&n<=max?n:null;
const round=n=>Math.round(n*10)/10;
const present=(rows,key,min=0,max=Number.MAX_SAFE_INTEGER)=>rows.map(r=>finite(r?.[key],min,max)).filter(v=>v!==null);

export function percentile(values,p){
  const sorted=[...values].sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const at=(sorted.length-1)*p,low=Math.floor(at),high=Math.ceil(at);
  return round(sorted[low]+(sorted[high]-sorted[low])*(at-low));
}

export function summarizeQoE(rows=[]){
  const latency=present(rows,"latency_ms",0,60000),jitter=present(rows,"jitter_ms",0,60000);
  const loss=present(rows,"packet_loss_pct",0,100),failures=present(rows,"request_failure_pct",0,100),down=present(rows,"down_kbps",0,10000000);
  return {sampleCount:rows.length,latencyP50Ms:percentile(latency,.5),latencyP95Ms:percentile(latency,.95),
    jitterP95Ms:percentile(jitter,.95),packetLossP95Pct:percentile(loss,.95),requestFailureP95Pct:percentile(failures,.95),downP50Kbps:percentile(down,.5),
    sources:[...new Set(rows.map(r=>r.source).filter(Boolean))]};
}

export function diagnoseNetwork({telemetry=[],qoe=[],ap=null,dns=[]}={}){
  const issues=[];
  const cpu=present(telemetry.slice(0,5),"cpu_load_pct",0,100);
  if(cpu.length>=3&&percentile(cpu,.5)>=85)issues.push({code:"router_cpu_pressure",segment:"gateway",severity:"warning",confidencePct:80,evidence:{cpuMedianPct:percentile(cpu,.5),samples:cpu.length}});
  const channel=finite(ap?.channel_util_pct,0,100);
  if(channel!==null&&channel>=85)issues.push({code:"wifi_channel_busy",segment:"device_ap",severity:"warning",confidencePct:70,evidence:{channelUtilPct:channel,apSource:ap.source}});
  const rssi=finite(ap?.median_rssi_dbm,-120,0);
  if(rssi!==null&&rssi<=-75)issues.push({code:"wifi_weak_signal",segment:"device_ap",severity:"warning",confidencePct:65,evidence:{medianRssiDbm:rssi,apSource:ap.source}});
  const q=summarizeQoE(qoe);
  if(q.sampleCount>=5&&q.requestFailureP95Pct!==null&&q.requestFailureP95Pct>=5)issues.push({code:"observed_request_failures",segment:"path_unknown",severity:"warning",confidencePct:45,evidence:{requestFailureP95Pct:q.requestFailureP95Pct,sources:q.sources}});
  if(q.sampleCount>=5&&q.packetLossP95Pct!==null&&q.packetLossP95Pct>=5)issues.push({code:"measured_packet_loss",segment:"path_unknown",severity:"warning",confidencePct:65,evidence:{packetLossP95Pct:q.packetLossP95Pct,sources:q.sources}});
  const dnsValues=present(dns,"latency_ms",0,60000);
  if(dnsValues.length>=5&&percentile(dnsValues,.95)>=500)issues.push({code:"dns_slow",segment:"dns",severity:"warning",confidencePct:60,evidence:{p95Ms:percentile(dnsValues,.95),samples:dnsValues.length}});
  return {issues,segments:{deviceAp:ap?"measured":"unavailable",gateway:cpu.length?"measured":"unavailable",wan:"unavailable",dns:dnsValues.length?"measured":"unavailable",external:q.sampleCount?"observed_end_to_end":"unavailable"}};
}

export function forecastCongestion(telemetry=[]){
  const points=telemetry.slice(0,12).map(s=>finite(s.cpu_load_pct,0,100)).filter(v=>v!==null).reverse();
  if(points.length<6)return {status:"insufficient_data",confidencePct:0,predictedCpuPct:null};
  const earlier=points.slice(0,Math.floor(points.length/2));
  const later=points.slice(Math.floor(points.length/2));
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const slope=avg(later)-avg(earlier);
  const prediction=Math.max(0,Math.min(100,avg(later)+slope));
  return {status:slope>=8&&prediction>=80?"rising":"stable",confidencePct:55,predictedCpuPct:round(prediction),basis:"two_window_cpu_trend"};
}

export function allocateFairShare(clients=[],capacityKbps){
  const cap=finite(capacityKbps,1,10000000);
  if(cap===null||!Array.isArray(clients)||!clients.length)return {status:"insufficient_data",allocations:[]};
  const valid=clients.filter(c=>typeof c.id==="string"&&c.id.length<=100&&finite(c.planMaxKbps,1,10000000)!==null);
  if(valid.length!==clients.length)return {status:"invalid_input",allocations:[]};
  const allocations=new Map(valid.map(c=>[c.id,0]));
  let remaining=cap,open=[...valid];
  for(let rounds=0;rounds<valid.length&&remaining>0&&open.length;rounds++){
    const share=remaining/open.length;
    const next=[];
    for(const client of open){
      const available=client.planMaxKbps-allocations.get(client.id);
      const add=Math.min(share,available);
      allocations.set(client.id,allocations.get(client.id)+add);remaining-=add;
      if(available>share)next.push(client);
    }
    if(next.length===open.length)break;
    open=next;
  }
  return {status:"recommendation",allocations:valid.map(c=>({id:c.id,kbps:Math.floor(allocations.get(c.id))})),unusedKbps:Math.max(0,Math.floor(remaining))};
}

export function chooseClusterGateway(members=[]){
  const eligible=members.filter(m=>m.enabled&&m.online&&finite(m.link_down_kbps,1,10000000)!==null&&finite(m.estimated_load_kbps,0,10000000)!==null);
  if(!eligible.length)return {status:"insufficient_data",routerId:null};
  const sorted=eligible.map(m=>({id:m.router_id,sector:m.sector,headroomKbps:Math.max(0,m.link_down_kbps-m.estimated_load_kbps),weight:finite(m.weight,1,100)||1}))
    .sort((a,b)=>(b.headroomKbps*b.weight)-(a.headroomKbps*a.weight));
  return {status:"recommendation",routerId:sorted[0].id,sector:sorted[0].sector,headroomKbps:sorted[0].headroomKbps,scope:"new_clients_only"};
}

export function recommendDns(probes=[]){
  const byResolver=new Map();
  for(const p of probes){if(typeof p.resolver!=="string"||!p.resolver||!p.source)continue;
    const key=p.source+":"+p.resolver,bucket=byResolver.get(key)||{source:p.source,resolver:p.resolver,total:0,successes:[]};
    bucket.total++;if(p.success===1&&finite(p.latency_ms,0,60000)!==null)bucket.successes.push(p.latency_ms);byResolver.set(key,bucket)}
  const candidates=[...byResolver.values()].filter(x=>x.total>=5&&x.successes.length/x.total>=.8)
    .map(x=>({source:x.source,resolver:x.resolver,p95Ms:percentile(x.successes,.95),samples:x.total,successPct:round(100*x.successes.length/x.total)}));
  const sources=[...new Set(candidates.map(x=>x.source))];
  const comparable=sources.map(source=>candidates.filter(x=>x.source===source)).find(rows=>rows.length>=2);
  if(!comparable)return {status:"insufficient_comparison",best:null,candidates};
  comparable.sort((a,b)=>a.p95Ms-b.p95Ms);
  return {status:"recommendation",best:comparable[0],candidates:comparable,scope:"same_measurement_source_only"};
}

export function recommendWifi(apSamples=[]){
  const rows=apSamples.filter(s=>finite(s.channel_util_pct,0,100)!==null);
  if(!rows.length)return {status:"unavailable",reason:"ap_adapter_not_reporting"};
  const busy=rows.filter(s=>s.channel_util_pct>=85);
  return {status:busy.length?"recommendation":"healthy",busyAps:busy.map(s=>({apId:s.ap_id,channel:s.channel,channelUtilPct:s.channel_util_pct})),action:"review_channel_and_placement"};
}

export function evaluatePolicy({policy=null,telemetry=[],qoe=[],apSamples=[],dnsProbes=[],clusterMembers=[]}={}){
  const quality=summarizeQoE(qoe),diagnosis=diagnoseNetwork({telemetry,qoe,ap:apSamples[0]||null,dns:dnsProbes});
  const forecast=forecastCongestion(telemetry),wifi=recommendWifi(apSamples),dns=recommendDns(dnsProbes),cluster=chooseClusterGateway(clusterMembers);
  const cpu=present(telemetry.slice(0,5),"cpu_load_pct",0,100);
  const queueProfile=policy?.profile||"standard";
  const queueSafe=cpu.length>=3&&percentile(cpu,.5)<75&&policy?.verified_at&&!!policy?.fasttrack_verified;
  const congestion={status:queueSafe?"candidate":"needs_validation",profile:queueProfile,reason:queueSafe?"measured_cpu_and_fasttrack_verified":"cpu_or_fasttrack_not_verified"};
  const recovery={status:"armed_only_after_baseline",requiresSnapshot:true,automaticRollback:false};
  const modules={
    smartBoost:{status:quality.sampleCount>=5&&cpu.length>=3?"recommendation":"insufficient_data",mode:policy?.mode||"observe",appliesAutomatically:false},
    smartCluster:cluster,
    smartQoE:{status:quality.sampleCount?"measured":"unavailable",...quality},
    bottleneckDiagnosis:{status:diagnosis.issues.length?"attention":Object.values(diagnosis.segments).some(x=>x!=="unavailable")?"no_issue_detected":"unavailable",...diagnosis},
    predictiveOptimization:forecast,
    contextualPriority:{status:"requires_trusted_classification",method:"approved_dscp_only",appliesAutomatically:false},
    automaticRecovery:recovery,
    airtimeIntelligence:wifi,
    congestionControl:congestion,
    fairBandwidth:{status:policy?.site_down_kbps>0?"ready_to_simulate":"capacity_not_configured",appliesAutomatically:false},
    wifiOptimization:wifi,
    dnsOptimization:dns
  };
  return {modules,generatedAt:Date.now(),trafficPlane:"local_router",automaticActionsEnabled:false};
}
