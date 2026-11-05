import assert from "node:assert/strict";
import {allocateFairShare,chooseClusterGateway,diagnoseNetwork,evaluatePolicy,forecastCongestion,recommendDns,recommendWifi,summarizeQoE} from "../src/smartnet-engine.js";

assert.equal(summarizeQoE([]).latencyP95Ms,null);
assert.equal(evaluatePolicy().modules.smartQoE.status,"unavailable");
assert.equal(evaluatePolicy().modules.airtimeIntelligence.status,"unavailable");
const qoe=Array.from({length:6},(_,i)=>({source:"browser_voluntary",latency_ms:20+i,jitter_ms:2,request_failure_pct:0,down_kbps:5000}));
assert.equal(summarizeQoE(qoe).sampleCount,6);
assert.equal(diagnoseNetwork({telemetry:[{cpu_load_pct:90},{cpu_load_pct:91},{cpu_load_pct:88}],qoe}).issues[0].code,"router_cpu_pressure");
assert.equal(forecastCongestion([{cpu_load_pct:90}]).status,"insufficient_data");
assert.equal(allocateFairShare([{id:"a",planMaxKbps:2000},{id:"b",planMaxKbps:10000}],10000).allocations[0].kbps,2000);
assert.equal(chooseClusterGateway([{router_id:"a",enabled:1,online:true,link_down_kbps:10000,estimated_load_kbps:9000,weight:1,sector:"A"},{router_id:"b",enabled:1,online:true,link_down_kbps:10000,estimated_load_kbps:1000,weight:1,sector:"B"}]).routerId,"b");
assert.equal(recommendWifi([]).status,"unavailable");
const dns=[...Array.from({length:5},()=>({source:"router",resolver:"1.1.1.1",success:1,latency_ms:20})),...Array.from({length:5},()=>({source:"router",resolver:"8.8.8.8",success:1,latency_ms:40}))];
assert.equal(recommendDns(dns).best.resolver,"1.1.1.1");
assert.equal(recommendDns(dns.slice(0,5)).status,"insufficient_comparison");
console.log("SmartNet decision checks passed: empty data, QoE, diagnosis, prediction, fairness, cluster, Wi-Fi and DNS comparison.");
