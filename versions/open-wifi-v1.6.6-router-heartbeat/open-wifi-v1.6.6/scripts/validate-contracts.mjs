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

const healthEnv = { ...env, DB: { prepare() { return { async first() { return { ok: 1 }; } }; } } };
const healthResponse = await status("/health", "GET", "", 200, healthEnv);
assert.equal((await healthResponse.json()).version, "1.6.6-router-heartbeat");

const readRoutes = ["me", "platform", "dashboard", "routers", "analytics", "diagnostics", "events", "report", "report.csv", "users", "plans", "codes", "groups", "audit", "accounts"];
for (const route of readRoutes) await status(`/api/admin/${route}`, "GET", "", 401);
for (const badCookie of ["ow_admin=invalid", cookie("viewer", { exp: Date.now() - 1000 }), cookie("invalid-role"), cookie().replace(/.$/, "!")]) {
  await status("/api/admin/me", "GET", badCookie, 401);
}

const adminOnly = [
  ["POST", "routers/enrollment"], ["POST", "routers/test-router/disable"], ["DELETE", "routers/test-router"],
  ["POST", "plans"], ["PUT", "plans/test-plan"], ["DELETE", "plans/test-plan"],
  ["PUT", "config"], ["PUT", "event"], ["POST", "media/logo"], ["DELETE", "media/background"],
  ["GET", "accounts"], ["POST", "accounts"], ["PUT", "accounts/test-account"], ["DELETE", "accounts/test-account"],
];
for (const role of ["viewer", "operator"]) {
  for (const [method, route] of adminOnly) await status(`/api/admin/${route}`, method, cookie(role), 403);
}
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

const accountLookups = [];
const d1Env = { ...env, DB: { prepare(sql) { return { bind(...args) {
  accountLookups.push({ sql, args });
  return { async first() { return { username: "test-user", display_name: "Current role", role: "viewer", enabled: 1 }; } };
} }; } } };
await status("/api/admin/config", "PUT", cookie("admin", { source: "d1" }), 403, d1Env);
assert.ok(accountLookups.every(({ args }) => args[0] === "test-current-site"), "Session refresh must use configured site");
const disabledEnv = { ...env, DB: { prepare() { return { bind() { return { async first() { return { enabled: 0 }; } }; } }; } } };
await status("/api/admin/me", "GET", cookie("admin", { source: "d1" }), 401, disabledEnv);

for (const [method, path] of [["GET", "agent.rsc"], ["GET", "installer.rsc"], ["POST", "poll"], ["POST", "ack"], ["POST", "install-status"]]) {
  await status(`/api/router/${path}`, method, "", 401);
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
      if(/FROM router_devices\s+WHERE token_hash/i.test(sql))return{id:"poll-router",site_id:"test-current-site",enabled:1,last_seen_at:persistedRouterSeen,install_status:"online"};
      if(/SELECT router_last_seen_at\s+FROM sites/i.test(sql))return{router_last_seen_at:persistedSiteSeen};
      if(/COUNT\(\*\) AS c FROM router_hosts/i.test(sql))return{c:0};
      return null;
    },
    async all(){return{results:[]}},
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
assert.equal((await pollHeartbeat()).heartbeatPersisted,false);
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
    return { async all() {
      if (/FROM sites/i.test(sql)) return { results: [{ id: siteId, name: "Local test", sales_enabled: 1 }] };
      if (/FROM router_devices/i.test(sql)) return { results: [{ site_id: siteId, total: 3, online: 1, disabled: 1 }] };
      return { results: [] };
    } };
  } }; } } };
  const response = await status(`/api/admin/platform?siteId=untrusted-other-site&site=untrusted-other-site`, "GET", cookie("viewer"), 200, siteEnv);
  const data = await response.json();
  assert.equal(boundQueries.length, 9);
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
