import assert from "node:assert/strict";
import { createHmac, timingSafeEqual, webcrypto } from "node:crypto";
import worker from "../src/index.js";

// Local contract harness. Cloudflare extends SubtleCrypto with timingSafeEqual;
// Node does not. This adapter changes the test runtime, never the Worker.
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!crypto.subtle.timingSafeEqual) {
  crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
globalThis.fetch = () => { throw new Error("Network is prohibited in local contract tests"); };
const secret = "test-only-session-secret-not-a-deployment-secret";
const env = {
  ADMIN_SESSION_SECRET: secret,
  OPENWIFI_SITE_ID: "test-current-site",
  MP_ACCESS_TOKEN: "TEST_SECRET_MUST_NOT_APPEAR_IN_HTML",
  ROUTER_API_TOKEN: "TEST_ROUTER_SECRET_MUST_NOT_APPEAR_IN_HTML",
  DB: { prepare() { throw new Error("Unexpected database access in authorization test"); } },
};
let checks = 0;
function cookie(role = "viewer", overrides = {}) {
  const payload = Buffer.from(JSON.stringify({
    sub: "test-user", displayName: "Local test", role, source: "env",
    exp: Date.now() + 60000, ...overrides,
  })).toString("base64url");
  return `ow_admin=${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
async function request(path, method = "GET", session = "", testEnv = env, body) {
  return worker.fetch(new Request(`https://openwifi.invalid${path}`, {
    method, headers: session ? { cookie: session, "content-type": "application/json" } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), testEnv, { waitUntil() { throw new Error("Unexpected background work"); } });
}
async function status(path, method, session, expected, testEnv = env) {
  const response = await request(path, method, session, testEnv, ["POST", "PUT"].includes(method) ? {} : undefined);
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}`);
  checks += 1;
  return response;
}

const healthEnv = { ...env, DB: { prepare() { return { bind() { return { async first() { return null; } }; }, async first() { return { ok: 1 }; } }; } } };
const healthResponse = await status("/health", "GET", "", 200, healthEnv);
assert.equal((await healthResponse.json()).version, "1.6.9-router-operations-team-fix");

const readRoutes = ["me", "platform", "dashboard", "routers", "analytics", "diagnostics", "events", "report", "report.csv", "users", "plans", "codes", "groups", "audit", "accounts", "connections"];
for (const route of readRoutes) await status(`/api/admin/${route}`, "GET", "", 401);
for (const badCookie of ["ow_admin=invalid", cookie("viewer", { exp: Date.now() - 1000 }), cookie("invalid-role"), cookie().replace(/.$/, "!")]) {
  await status("/api/admin/me", "GET", badCookie, 401);
}

const adminOnly = [
  ["POST", "routers/enrollment"], ["POST", "routers/test-router/disable"], ["DELETE", "routers/test-router"],
  ["POST", "plans"], ["PUT", "plans/test-plan"], ["DELETE", "plans/test-plan"],
  ["PUT", "config"], ["PUT", "event"], ["POST", "media/logo"], ["DELETE", "media/background"],
  ["GET", "accounts"], ["POST", "accounts"], ["PUT", "accounts/test-account"], ["DELETE", "accounts/test-account"],
  ["GET", "connections"], ["PUT", "connections/MP_ACCESS_TOKEN"], ["DELETE", "connections/MP_ACCESS_TOKEN"],
];
for (const role of ["viewer", "operator"]) {
  for (const [method, route] of adminOnly) await status(`/api/admin/${route}`, method, cookie(role), 403);
}
await status("/api/admin/connections/MP_ACCESS_TOKEN", "PUT", cookie("admin"), 403);
await status("/api/admin/connections/MP_WEBHOOK_SECRET", "DELETE", cookie("admin"), 403);
for (const route of ["users/test-user/courtesy", "users/revoke", "emergency", "codes", "codes/test-code/cancel", "reconcile"]) {
  await status(`/api/admin/${route}`, "POST", cookie("viewer"), 403);
}
const cancelQueries=[];
const cancelEnv={...env,DB:{
  prepare(sql){return{bind(...args){cancelQueries.push({sql,args});return{
    async first(){return{id:"test-code",code:"TESTCODE",status:"consumed",redeemed_device_id:"test-device"}},
    async run(){return{meta:{changes:1}}}
  }}}},
  async batch(statements){assert.equal(statements.length,2);return[{meta:{changes:1}},{meta:{changes:1}}]}
}};
const cancelled=await request("/api/admin/codes/test-code/cancel","POST",cookie("operator"),cancelEnv,{});
assert.equal(cancelled.status,200);
assert.equal((await cancelled.json()).grantRevoked,true);
assert.ok(cancelQueries.every(({args})=>args.includes("test-current-site")),"Cancellation must stay within the configured site");
assert.ok(cancelQueries.some(({sql,args})=>/UPDATE access_grants/.test(sql)&&args.includes("code-test-code")&&/grant_source='code'/.test(sql)),"Cancellation must revoke only its code grant");
checks+=1;
for (const role of ["viewer", "operator", "admin", "owner"]) {
  const response = await status("/api/admin/me", "GET", cookie(role), 200);
  assert.equal((await response.json()).user.role, role);
}
await status("/api/admin/accounts/env-owner", "DELETE", cookie("owner"), 409);

const encryptedRows=new Map();
const connectionEnv={...env,INTEGRATIONS_ENCRYPTION_KEY:"local-test-key-only",MP_WEBHOOK_SECRET:"cloudflare-fallback-secret",DB:{prepare(sql){return{
  bind(...args){return{
    async first(){if(/FROM integration_secrets/.test(sql))return encryptedRows.get(args[1])||null;return null},
    async run(){if(/INSERT INTO integration_secrets/.test(sql))encryptedRows.set(args[1],{iv_b64:args[2],ciphertext_b64:args[3],updated_at:args[4]});if(/DELETE FROM integration_secrets/.test(sql))encryptedRows.delete(args[1]);return{meta:{changes:1}}}
  }}
}}}};
const webhookValue="local-test-webhook-secret-123";
const savedWebhook=await request("/api/admin/connections/MP_WEBHOOK_SECRET","PUT",cookie("owner"),connectionEnv,{value:webhookValue});
assert.equal(savedWebhook.status,200);
assert.ok(!JSON.stringify(await savedWebhook.json()).includes(webhookValue));
assert.ok(!JSON.stringify([...encryptedRows.values()]).includes(webhookValue));
const listedConnections=await request("/api/admin/connections","GET",cookie("admin"),connectionEnv);
assert.equal((await listedConnections.json()).integrations.MP_WEBHOOK_SECRET.source,"panel");
const restoredWebhook=await request("/api/admin/connections/MP_WEBHOOK_SECRET","DELETE",cookie("owner"),connectionEnv);
assert.equal((await restoredWebhook.json()).status.source,"cloudflare");
checks+=4;

const accountLookups = [];
const d1Env = { ...env, DB: { prepare(sql) { return { bind(...args) {
  accountLookups.push({ sql, args });
  return { async first() { return { username: "test-user", display_name: "Current role", role: "viewer", enabled: 1 }; } };
} }; } } };
await status("/api/admin/config", "PUT", cookie("admin", { source: "d1" }), 403, d1Env);
assert.ok(accountLookups.every(({ args }) => args[0] === "test-current-site"), "Session refresh must use configured site");
const disabledEnv = { ...env, DB: { prepare() { return { bind() { return { async first() { return { enabled: 0 }; } }; } }; } } };
await status("/api/admin/me", "GET", cookie("admin", { source: "d1" }), 401, disabledEnv);

const teamWrites=[];
const teamEnv={...env,DB:{
  prepare(sql){return{bind(...args){return{
    async first(){return null},
    async all(){if(/SELECT id FROM router_devices/.test(sql))return{results:[{id:"router-a"}]};return{results:[]}},
    async run(){teamWrites.push({sql,args});return{meta:{changes:1}}}
  }} }},
  async batch(statements){assert.equal(statements.length,2);return statements.map(()=>({meta:{changes:1}}))}
}};
await status("/api/admin/accounts", "POST", cookie("owner"), 400, teamEnv);
const accountCreated=await request("/api/admin/accounts","POST",cookie("owner"),teamEnv,{username:"staff1",displayName:"Equipe teste",role:"operator",password:"example-password",routerScopeMode:"selected",routerPermissions:[{routerId:"router-a",canView:true,canEdit:false}]});
assert.equal(accountCreated.status,200);
assert.ok(teamWrites.some(({sql,args})=>/INSERT INTO admin_accounts/.test(sql)&&args.includes(100000)&&args.includes("selected")),"New team password must use the Cloudflare-supported PBKDF2 count");
checks+=2;

const speedDownload=await request("/api/admin/speed-test/download","GET",cookie("owner"));
assert.equal(speedDownload.status,200);
assert.equal((await speedDownload.arrayBuffer()).byteLength,2*1024*1024);
const speedUpload=await worker.fetch(new Request("https://openwifi.invalid/api/admin/speed-test/upload",{method:"POST",headers:{cookie:cookie("owner"),"content-type":"application/octet-stream"},body:new Uint8Array(1024)}),env,{});
assert.equal((await speedUpload.json()).bytes,1024);
checks+=2;

const scopedEnv={...env,DB:{prepare(sql){return{bind(...args){return{
  async first(){if(/FROM admin_accounts/.test(sql))return{id:"account-a",username:"test-user",display_name:"Scoped",role:"operator",enabled:1,router_scope_mode:"selected"};if(/FROM router_devices WHERE id=/.test(sql))return{id:args[0],site_id:"test-current-site",enabled:1};if(/FROM admin_router_permissions arp/.test(sql)&&args[1]==="router-a")return{can_view:1,can_edit:0};return null},
  async all(){if(/SELECT router_id,can_view,can_edit/.test(sql))return{results:[{router_id:"router-a",can_view:1,can_edit:0}]};if(/FROM router_devices/.test(sql))return{results:[{id:"router-a",site_id:"test-current-site",enabled:1},{id:"router-b",site_id:"test-current-site",enabled:1}]};return{results:[]}}
}}}}}};
await status("/api/admin/platform","GET",cookie("operator",{source:"d1"}),403,scopedEnv);
const scopedRouters=await request("/api/admin/routers","GET",cookie("operator",{source:"d1"}),scopedEnv);
assert.deepEqual((await scopedRouters.json()).routers.map(r=>r.id),["router-a"]);
await status("/api/admin/routers/router-b/hosts","GET",cookie("operator",{source:"d1"}),404,scopedEnv);
await status("/api/admin/routers/router-a/hosts","GET",cookie("operator",{source:"d1"}),200,scopedEnv);
await status("/api/admin/routers/router-a/preset","PUT",cookie("operator",{source:"d1"}),404,scopedEnv);
checks+=2;

for (const [method, path] of [["GET", "agent.rsc"], ["GET", "installer.rsc"], ["POST", "poll"], ["POST", "ack"], ["POST", "install-status"]]) {
  await status(`/api/router/${path}`, method, "", 401);
}
const customRouter={id:"test-router",site_id:"test-current-site",enabled:1,hotspot_server:"hotspot-cho",install_mode:"hotspot",wan_interface:"ether1",lan_ports_json:"[]"};
const routerScriptEnv={OPENWIFI_BASE_URL:"https://openwifi.invalid",DB:{
  prepare(){return{bind(){return{async first(){return customRouter}}}}}
}};
async function routerScript(kind){
  const response=await worker.fetch(new Request(`https://openwifi.invalid/api/router/${kind}.rsc`,{
    headers:{authorization:"Bearer test-individual-router-token"}
  }),routerScriptEnv,{});
  assert.equal(response.status,200);
  return response.text();
}
const customAgent=await routerScript("agent");
assert.equal((customAgent.match(/server="hotspot-cho"/g)||[]).length,2);
assert.ok(!customAgent.includes('server="openwifi-hotspot"'));
const safeInstaller=await routerScript("installer");
assert.match(safeInstaller,/:local parsedAgent \[:parse \$agentSource\]/);
assert.match(safeInstaller,/openwifi-cloud-poll-candidate/);
assert.match(safeInstaller,/on-event=\$oldEvent interval=\$oldInterval policy=\$oldPolicy disabled=\$oldDisabled/);
assert.ok(safeInstaller.includes('" . $installStep . "'));
checks+=4;
customRouter.install_mode="agent";
const agentOnlyInstaller=await routerScript("installer");
assert.match(agentOnlyInstaller,/:local hsId \[\/ip hotspot find where name="hotspot-cho"\]/);
assert.ok(!agentOnlyInstaller.includes("/ip hotspot walled-garden add"));
customRouter.install_mode="full";
customRouter.lan_ports_json='["ether2"]';
const fullInstaller=await routerScript("installer");
assert.ok(fullInstaller.indexOf("openwifi_wan_already_bridged")<fullInstaller.indexOf('/interface bridge add name="bridgeLocal"'));
assert.match(fullInstaller,/openwifi_lan_port_missing/);
checks+=2;

const invalidFullBase={installMode:"full",name:"Test RB",wanInterface:"ether1",lanPorts:["ether2"],networkCidr:"10.77.0.0/24",gatewayIp:"10.77.0.1",poolRange:"10.77.0.10-10.77.0.254",hotspotServer:"openwifi-hotspot"};
for(const [change,expected] of [
  [{lanPorts:["ether1"]},"wan_port_cannot_be_lan"],
  [{networkCidr:"10.77.0.1/24"},"network_address_not_canonical"],
  [{gatewayIp:"10.78.0.1"},"gateway_outside_network"],
  [{poolRange:"10.77.0.1-10.77.0.200"},"pool_outside_network_or_overlaps_gateway"],
  [{lanPorts:["ether2", "bad port"]},"invalid_lan_ports"],
]){
  const response=await request("/api/admin/routers/enrollment","POST",cookie("admin"),env,{...invalidFullBase,...change});
  assert.equal(response.status,400);
  assert.equal((await response.json()).error,expected);
  checks++;
}
async function checkRouterRetirement(rows,expected) {
  let deletions=0;
  const testEnv={...env,DB:{
    prepare(sql){return{bind(...args){
      if (/FROM router_devices WHERE site_id=\?/i.test(sql)) assert.deepEqual(args,["test-current-site"]);
      return {async all(){return{results:rows}},async run(){return{meta:{changes:1}}}};
    }}},
    async batch(statements){assert.equal(statements.length,3);deletions++;return statements.map(()=>({meta:{changes:1}}))}
  }};
  const response=await request("/api/admin/routers/old","DELETE",cookie("admin"),testEnv);
  assert.equal(response.status,expected);
  assert.equal(deletions,expected===200?1:0);
  checks++;
}
const oldRouter={id:"old",name:"Old RB",enabled:0,install_status:"revoking",last_seen_at:100,enrolled_at:100,installed_at:null,serial_number:"same"};
await checkRouterRetirement([oldRouter],200);
await checkRouterRetirement([{...oldRouter,installed_at:90,last_seen_at:120},{id:"new",enabled:1,installed_at:150,enrolled_at:130,last_seen_at:Date.now(),serial_number:"same"}],200);
await checkRouterRetirement([{...oldRouter,installed_at:90,last_seen_at:120}],409);
await checkRouterRetirement([{...oldRouter,enabled:1}],409);
let persistedRouterSeen=Date.now()-5000;
let persistedSiteSeen=Date.now()-100000;
let routerHeartbeatWrites=0,siteHeartbeatWrites=0;
const pollEnv={...env,ROUTER_HEARTBEAT_MS:"30000",DB:{
  prepare(sql){return{bind(){return{
    async first(){
      if(/FROM router_devices\s+WHERE token_hash/i.test(sql))return{id:"poll-router",site_id:"test-current-site",enabled:1,last_seen_at:persistedRouterSeen,install_status:"online",max_client_down_kbps:5000,max_client_up_kbps:1000};
      if(/SELECT router_last_seen_at\s+FROM sites/i.test(sql))return{router_last_seen_at:persistedSiteSeen};
      if(/COUNT\(\*\) AS c FROM router_hosts/i.test(sql))return{c:0};
      return null;
    },
    async all(){if(/SELECT mac,\s+MAX\(ends_at\)/i.test(sql))return{results:[{mac:"00:11:22:33:44:55",ends_at:Date.now()+60000,down_kbps:10000,up_kbps:0}]};return{results:[]}},
    async run(){
      if(/UPDATE router_devices\s+SET identity=/i.test(sql)){routerHeartbeatWrites++;persistedRouterSeen=Date.now()}
      if(/UPDATE sites\s+SET router_last_seen_at=/i.test(sql)){siteHeartbeatWrites++;persistedSiteSeen=Date.now()}
      return{meta:{changes:1}};
    }
  }}}},
  async batch(){return[]}
}};
async function pollHeartbeat(){
  const response=await worker.fetch(new Request("https://openwifi.invalid/api/router/poll",{
    method:"POST",headers:{authorization:"Bearer test-individual-router-token","content-type":"application/json"},
    body:JSON.stringify({siteId:"test-current-site",routerId:"poll-router",router:{identity:"Test RB",version:"7.16.1"},hosts:[]})
  }),pollEnv,{});
  assert.equal(response.status,200);
  return response.json();
}
const firstPoll=await pollHeartbeat();
assert.equal(firstPoll.heartbeatPersisted,false);
assert.equal(firstPoll.access[0].downKbps,5000);
assert.equal(firstPoll.access[0].upKbps,1000);
assert.equal(routerHeartbeatWrites,0);
assert.equal(siteHeartbeatWrites,0);
persistedRouterSeen=Date.now()-31000;
assert.equal((await pollHeartbeat()).heartbeatPersisted,true);
assert.equal(routerHeartbeatWrites,1);
assert.equal(siteHeartbeatWrites,1);
assert.equal((await pollHeartbeat()).heartbeatPersisted,false);
assert.equal(routerHeartbeatWrites,1);
assert.equal(siteHeartbeatWrites,1);
checks+=3;
let versionGuardWrites=0;
const versionGuardEnv={...env,DB:{
  prepare(){return{bind(){return{
    async first(){return{site_id:"test-current-site",router_name:"Test Router",install_mode:"agent"}},
    async run(){versionGuardWrites++;throw new Error("Unsupported RouterOS must not write")}
  }}}},
  async batch(){versionGuardWrites++;throw new Error("Unsupported RouterOS must not enroll")}
}};
const versionGuardResponse=await worker.fetch(new Request("https://openwifi.invalid/api/router/enroll",{
  method:"POST",headers:{authorization:"Bearer test-enrollment", "content-type":"application/json"},
  body:JSON.stringify({identity:"Legacy",version:"6.49.13 (long-term)"})
}),versionGuardEnv,{});
assert.equal(versionGuardResponse.status,422);
assert.equal((await versionGuardResponse.json()).error,"routeros_7_required");
assert.equal(versionGuardWrites,0);
checks++;
for (const path of ["/", "/admin", "/portal", "/group"]) {
  const response = await status(path, "GET", "", 200);
  const html = await response.text();
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(!html.includes(env.MP_ACCESS_TOKEN) && !html.includes(env.ROUTER_API_TOKEN), "Secrets must not be interpolated into public HTML");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  for (const [, script] of scripts) Function(script);
  if (path === "/") assert.match(html, /<h1>Seu Wi-Fi organizado/);
}
await status("/does-not-exist", "GET", "", 404);

for (const siteId of ["site-a", "site-b"]) {
  const boundQueries = [];
  const siteEnv = { ...env, OPENWIFI_SITE_ID: siteId, DB: { prepare(sql) { return { bind(...args) {
    boundQueries.push({ sql, args });
    assert.match(sql, /WHERE\s+(?:site_id|id)=\?/i, "Every platform query must explicitly restrict the site");
    assert.ok(args.includes(siteId), "Every platform query must bind configured site");
    return { async first() { return null; }, async all() {
      if (/FROM sites/i.test(sql)) return { results: [{ id: siteId, name: "Local test", sales_enabled: 1 }] };
      if (/FROM router_devices/i.test(sql)) return { results: [{ site_id: siteId, total: 3, online: 1, disabled: 1 }] };
      return { results: [] };
    } };
  } }; } } };
  const response = await status(`/api/admin/platform?siteId=untrusted-other-site&site=untrusted-other-site`, "GET", cookie("viewer"), 200, siteEnv);
  const data = await response.json();
  assert.equal(boundQueries.length, 11);
  assert.deepEqual(data.scope, { mode: "single-site", siteId, canSwitchSite: false });
  assert.equal(data.currentSiteId, siteId);
  assert.deepEqual(data.sites.map(site => site.id), [siteId]);
  assert.equal(data.summary.routers, 3);
  assert.equal(data.summary.routersOnline, 1);
  assert.equal(data.summary.routersOffline, 1);
  assert.equal(data.summary.routersDisabled, 1);
  assert.equal(data.summary.grossMonthCents, 0);
}
const heartbeatNow = Date.now();
const routerQueries = [];
const routerEnv = { ...env, ROUTER_OFFLINE_AFTER_MS: "5000", DB: { prepare(sql) { return { bind(...args) {
  routerQueries.push({ sql, args });
  assert.equal(args[0], "test-current-site");
  return { async all() { return { results: /FROM router_devices/i.test(sql) ? [
    { id: "fresh", enabled: 1, last_seen_at: heartbeatNow - 100, lan_ports_json: "[]" },
    { id: "stale", enabled: 1, last_seen_at: heartbeatNow - 10000, lan_ports_json: "[]" },
    { id: "disabled", enabled: 0, last_seen_at: heartbeatNow - 100, lan_ports_json: "[]" },
    { id: "never", enabled: 1, last_seen_at: null, lan_ports_json: "[]" },
  ] : [] }; } };
} }; } } };
const routerResponse = await status("/api/admin/routers?siteId=other", "GET", cookie("viewer"), 200, routerEnv);
const routerData = await routerResponse.json();
assert.equal(routerQueries.length, 2);
assert.equal(routerData.offlineAfterMs, 5000);
assert.equal(typeof routerData.generatedAt, "number");
assert.deepEqual(routerData.routers.map(router => [router.id, router.online]), [["fresh", true], ["stale", false], ["disabled", false], ["never", false]]);
console.log(`${checks} local Worker contract checks passed: public pages, secrets, authorization, session refresh, two configured sites, platform isolation and router heartbeat states. No live APIs or D1 used.`);
