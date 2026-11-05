import assert from "node:assert/strict";
import {recordRouterTelemetry,getRouterTelemetry,pruneRouterTelemetry,withWanRates} from "../src/smartnet.js";

const writes=[];
const env={OPENWIFI_SITE_ID:"site-a",DB:{
  prepare(sql){return{bind(...args){return{
    async run(){writes.push({sql,args});return{meta:{changes:1}}},
    async first(){return sql.includes("FROM router_devices")?{id:"router-a",name:"RB teste",version:"7.16.1",enabled:1}:null},
    async all(){return{results:[]}}
  }}}}
}};
const auth={legacy:false,siteId:"site-a",routerId:"router-a",router:{enabled:1}};
const now=Date.now();
await recordRouterTelemetry(env,auth,{cpuLoadPct:23,freeMemoryBytes:100,totalMemoryBytes:200,uptime:"2d1h"},now,4);
assert.equal(writes.length>=1,true);
assert.deepEqual(writes[0].args.slice(0,2),["site-a","router-a"]);
assert.deepEqual(writes[0].args.slice(4,9),[23,100,200,"2d1h",4]);
assert.deepEqual(writes[0].args.slice(9,12),[null,null,null]);
await recordRouterTelemetry(env,auth,{cpuLoadPct:20,wanInterface:"ether1",wanRxBytes:"1200000",wanTxBytes:"500000"},now+120000,4);
assert.deepEqual(writes.at(-1).args.slice(9,12),["ether1",1200000,500000]);
const measured=withWanRates([{received_at:120000,wan_interface:"ether1",wan_rx_bytes:1200000,wan_tx_bytes:500000},{received_at:60000,wan_interface:"ether1",wan_rx_bytes:600000,wan_tx_bytes:200000}]);
assert.equal(measured[0].wan_rx_kbps,80);
assert.equal(withWanRates([{received_at:120000,wan_interface:"ether2",wan_rx_bytes:1200000,wan_tx_bytes:500000},measured[1]])[0].wan_rx_kbps,null);
await recordRouterTelemetry(env,auth,{cpuLoadPct:"24%",freeMemoryBytes:"64MiB",totalMemoryBytes:"128MiB",uptime:"2d1h"},now+60000,4);
assert.deepEqual(writes.at(-1).args.slice(4,7),[24,67108864,134217728]);
const before=writes.length;
await recordRouterTelemetry(env,{...auth,legacy:true},{cpuLoadPct:23},now,0);
await recordRouterTelemetry(env,auth,{cpuLoadPct:999},now,0);
await recordRouterTelemetry(env,auth,{freeMemoryBytes:300,totalMemoryBytes:200},now,0);
assert.equal(writes.length,before,"Legacy, invalid or impossible telemetry must not be stored");
const hidden=await getRouterTelemetry(env,{routerScopeMode:"selected"},"router-b",async()=>false);
assert.equal(hidden.status,404);
assert.equal((await hidden.json()).error,"router_not_found");
const visible=await getRouterTelemetry(env,{routerScopeMode:"selected"},"router-a",async()=>true);
assert.equal(visible.status,200);
assert.equal((await visible.json()).latest,null);
await pruneRouterTelemetry(env,now);
assert.match(writes.at(-1).sql,/DELETE FROM router_telemetry_samples WHERE received_at/);
assert.equal(writes.at(-1).args[0],now-7*24*60*60*1000);
console.log("SmartNet observation checks passed: validation, legacy compatibility, router isolation and empty state.");
