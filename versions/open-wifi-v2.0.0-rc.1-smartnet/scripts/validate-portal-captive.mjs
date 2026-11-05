import assert from "node:assert/strict";
import vm from "node:vm";
import worker from "../src/index.js";

const response=await worker.fetch(new Request("https://openwifi.invalid/portal?site=test-site&mac=AA:BB:CC:DD:EE:FF"),{},{});
assert.equal(response.status,200);
const html=await response.text();
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].at(-1)?.[1];
assert.ok(script,"Portal script must exist");

const elements=new Map();
function element(id){
  if(!elements.has(id))elements.set(id,{
    textContent:"",value:"",src:"",disabled:false,checked:false,
    classList:{values:new Set(id==="loading"?[]:["hidden"]),add(v){this.values.add(v)},remove(v){this.values.delete(v)},toggle(v,on){if(on)this.values.add(v);else this.values.delete(v)}}
  });
  return elements.get(id);
}
const document={
  getElementById:element,
  querySelectorAll(){return[]},
  body:{style:{}}
};
let requests=0;
const context={
  document,location:{search:"?site=test-site&mac=AA:BB:CC:DD:EE:FF"},
  localStorage:{getItem(){throw new Error("storage denied")},setItem(){throw new Error("storage denied")}},
  fetch:async path=>{
    requests++;
    const data=path==="/api/device/register"
      ?{ok:true,deviceId:"server-assigned-id",activeUntil:null}
      :{ok:true,site:{name:"Test Wi-Fi",portalTitle:"Test",portalSubtitle:"",mode:"standard",salesEnabled:true},plans:[]};
    return{ok:true,async json(){return data}};
  },
  navigator:{clipboard:{writeText:async()=>{}}},URLSearchParams,Intl,Date,Number,String,Object,Array,Math,Promise,
  setTimeout,clearTimeout,encodeURIComponent
};
vm.runInNewContext(script,context,{timeout:1000});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(requests,2,"A captive browser with blocked storage must complete device registration and load plans");
assert.equal(element("homeBox").classList.values.has("hidden"),false);
assert.equal(element("loading").classList.values.has("hidden"),true);
console.log("Portal captive browser check passed: blocked storage still reaches plans.");
