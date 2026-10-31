const MP_BASE = "https://api.mercadopago.com";

const enc = new TextEncoder();

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });

const html = (body, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy":
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });


function fallbackLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="35" y1="25" x2="220" y2="230" gradientUnits="userSpaceOnUse">
  <stop stop-color="#6EA8FE"/><stop offset="1" stop-color="#8B7CF6"/></linearGradient></defs>
  <rect width="256" height="256" rx="58" fill="#0B1120"/>
  <path d="M61 100c39-34 95-34 134 0" fill="none" stroke="url(#g)" stroke-width="18" stroke-linecap="round"/>
  <path d="M84 129c25-22 63-22 88 0" fill="none" stroke="url(#g)" stroke-width="18" stroke-linecap="round"/>
  <path d="M108 157c11-10 29-10 40 0" fill="none" stroke="url(#g)" stroke-width="18" stroke-linecap="round"/>
  <path d="M128 180l24 24-24 24-24-24 24-24z" fill="url(#g)"/>
  </svg>`;
}
function fallbackLogoResponse() {
  return new Response(fallbackLogoSvg(), {
    headers:{"content-type":"image/svg+xml; charset=utf-8","cache-control":"public, max-age=3600","x-content-type-options":"nosniff"}
  });
}
async function siteImageAsset(url, env, kind) {
  const siteId=String(url.searchParams.get("site")||env.OPENWIFI_SITE_ID||"openwifi-main");
  const column=kind==="logo"?"logo_image_url":"background_image_url";
  const site=await env.DB.prepare(`SELECT ${column} AS image_url FROM sites WHERE id=?`).bind(siteId).first();
  const configured=String(site?.image_url||"").trim();

  if(!configured) {
    return kind==="logo"
      ? fallbackLogoResponse()
      : new Response("background_not_configured",{status:404});
  }

  if(configured.startsWith("r2://")) {
    if(!env.MEDIA) {
      return kind==="logo"
        ? fallbackLogoResponse()
        : new Response("media_storage_not_configured",{status:503});
    }

    const key=configured.slice(5);
    const object=await env.MEDIA.get(key);
    if(!object) {
      return kind==="logo"
        ? fallbackLogoResponse()
        : new Response("media_not_found",{status:404});
    }

    const headers=new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag",object.httpEtag||"");
    headers.set("cache-control","public, max-age=300");
    headers.set("x-content-type-options","nosniff");
    return new Response(object.body,{headers});
  }

  let target;
  try{target=new URL(configured)}catch{
    return kind==="logo"?fallbackLogoResponse():new Response("invalid_image_url",{status:400});
  }

  if(target.protocol!=="https:") {
    return kind==="logo"?fallbackLogoResponse():new Response("https_required",{status:400});
  }

  try{
    const upstream=await fetch(target.toString(),{
      headers:{
        "accept":"image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8",
        "user-agent":"OpenWiFi-ImageProxy/1.1"
      },
      cf:{cacheTtl:300,cacheEverything:true}
    });

    if(!upstream.ok)throw new Error("upstream_failed");

    const type=String(upstream.headers.get("content-type")||"").toLowerCase();
    if(!type.startsWith("image/"))throw new Error("not_image");

    const declaredSize=Number(upstream.headers.get("content-length")||0);
    if(declaredSize>5*1024*1024)return new Response("image_too_large",{status:413});
    if(!upstream.body)throw new Error("image_body_missing");

    return new Response(upstream.body,{
      headers:{
        "content-type":type,
        "cache-control":"public, max-age=300",
        "x-content-type-options":"nosniff"
      }
    });
  }catch{
    return kind==="logo"?fallbackLogoResponse():new Response("image_fetch_failed",{status:502});
  }
}
const normalizeMac = (mac = "") =>
  String(mac).trim().toUpperCase().replace(/-/g, ":");

const validMac = (mac) =>
  /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalizeMac(mac));

const bearer = (request) => {
  const h = request.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
};

const money = (cents) => (Number(cents) / 100).toFixed(2);

const safeJsonParse = (value) => {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
};

const safeLower = (v) => String(v || "").toLowerCase();

function uuid() {
  return crypto.randomUUID();
}


function normalizePhone(v = "") {
  let n = String(v).replace(/\D/g, "");
  if (!n) return "";
  if (n.length === 10 || n.length === 11) n = "55" + n;
  return n;
}

function randomCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function randomToken(bytesLength = 24) {
  const bytes = new Uint8Array(bytesLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

function bytesToBase64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value) {
  return bytesToBase64Url(enc.encode(value));
}

function base64UrlToString(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return atob(b64);
}

async function hmacBase64Url(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

function constantEqual(a, b) {
  const left=enc.encode(String(a||""));
  const right=enc.encode(String(b||""));
  if(left.byteLength!==right.byteLength||!left.byteLength)return false;
  return crypto.subtle.timingSafeEqual(left,right);
}

async function secureTextEqual(a,b) {
  const [left,right]=await Promise.all([
    crypto.subtle.digest("SHA-256",enc.encode(String(a||""))),
    crypto.subtle.digest("SHA-256",enc.encode(String(b||"")))
  ]);
  return crypto.subtle.timingSafeEqual(left,right);
}

async function tokenHash(value) {
  const digest=await crypto.subtle.digest("SHA-256",enc.encode(String(value||"")));
  return bytesToBase64Url(new Uint8Array(digest));
}

function safeRouterName(v, fallback="MikroTik") {
  const s=String(v||"").trim().replace(/[^\p{L}\p{N} ._#-]/gu,"").slice(0,80);
  return s||fallback;
}

function validRouterIdentifier(v) {
  return /^[A-Za-z0-9._:-]{1,64}$/.test(String(v||""));
}

function validIpv4(v) {
  const p=String(v||"").split(".");
  return p.length===4&&p.every(x=>/^\d{1,3}$/.test(x)&&Number(x)>=0&&Number(x)<=255);
}

function validCidr(v) {
  const m=String(v||"").match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/);
  return !!m&&validIpv4(m[1]);
}

function routerosQuote(v) {
  return String(v??"").replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\r?\n/g," ");
}


function base64UrlToBytes(value) {
  const b64=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4);
  const raw=atob(b64);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}

async function passwordDigest(password, saltBytes, iterations=210000) {
  const key=await crypto.subtle.importKey(
    "raw",enc.encode(String(password)),{name:"PBKDF2"},false,["deriveBits"]
  );
  const bits=await crypto.subtle.deriveBits(
    {name:"PBKDF2",hash:"SHA-256",salt:saltBytes,iterations},
    key,
    256
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

async function makePasswordRecord(password) {
  if(String(password||"").length<8)throw new Error("password_too_short");
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iterations=210000;
  return {
    salt:bytesToBase64Url(salt),
    hash:await passwordDigest(password,salt,iterations),
    iterations
  };
}

async function verifyPasswordRecord(password,row) {
  const salt=base64UrlToBytes(row.password_salt);
  const actual=await passwordDigest(password,salt,Number(row.password_iterations||210000));
  return constantEqual(actual,row.password_hash);
}

const ROLE_RANK={viewer:1,operator:2,admin:3,owner:4};

function roleAtLeast(session,role) {
  return Number(ROLE_RANK[session?.role]||0)>=Number(ROLE_RANK[role]||99);
}

async function createAdminSession(env, identity={}) {
  if(!env.ADMIN_SESSION_SECRET)throw new Error("ADMIN_SESSION_SECRET_not_configured");
  const hours=Number(env.ADMIN_SESSION_HOURS||12);
  const payload=JSON.stringify({
    sub:String(identity.username||env.ADMIN_USER||"admin"),
    displayName:String(identity.displayName||identity.username||"Admin"),
    role:String(identity.role||"owner"),
    source:String(identity.source||"env"),
    exp:Date.now()+hours*3600000,
    nonce:randomToken(8)
  });
  const encoded=stringToBase64Url(payload);
  const sig=await hmacBase64Url(env.ADMIN_SESSION_SECRET,encoded);
  return `${encoded}.${sig}`;
}

async function readAdminSession(request,env) {
  if(!env.ADMIN_SESSION_SECRET)return null;
  const token=cookieValue(request,"ow_admin");
  if(!token||!token.includes("."))return null;
  const [payload64,sig]=token.split(".",2);
  const expected=await hmacBase64Url(env.ADMIN_SESSION_SECRET,payload64);
  if(!constantEqual(sig,expected))return null;

  try{
    const payload=JSON.parse(base64UrlToString(payload64));
    if(Number(payload.exp)<=Date.now())return null;
    if(!ROLE_RANK[payload.role])return null;

    if(payload.source==="d1"){
      const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
      const account=await env.DB.prepare(`
        SELECT username,display_name,role,enabled
          FROM admin_accounts
         WHERE site_id=? AND username=?
         LIMIT 1
      `).bind(siteId,String(payload.sub||"")).first();

      if(!account||!account.enabled)return null;
      payload.role=account.role;
      payload.displayName=account.display_name;
    }

    return payload;
  }catch{
    return null;
  }
}

async function audit(env, siteId, action, details = {}) {
  await env.DB.prepare(`
    INSERT INTO admin_audit (id, site_id, action, details_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(uuid(), siteId, action, JSON.stringify(details), Date.now()).run();
}

function saoPauloDayBounds(now = Date.now()) {
  const d = new Date(now - 3 * 3600000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const start = Date.UTC(y, m, day, 3, 0, 0, 0);
  return { start, end: start + 86400000 };
}

async function ensureUniqueGroupCode(env, siteId) {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(8);
    const found = await env.DB.prepare(`
      SELECT 1 AS ok
        FROM (
          SELECT code FROM party_groups WHERE site_id = ? AND code = ?
          UNION ALL
          SELECT code FROM access_codes WHERE site_id = ? AND code = ?
        )
       LIMIT 1
    `).bind(siteId, code, siteId, code).first();
    if (!found) return code;
  }
  throw new Error("group_code_generation_failed");
}

async function ensureUniqueAccessCode(env, siteId) {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(8);
    const found = await env.DB.prepare(`
      SELECT 1 AS ok
        FROM (
          SELECT code FROM access_codes WHERE site_id = ? AND code = ?
          UNION ALL
          SELECT code FROM party_groups WHERE site_id = ? AND code = ?
        )
       LIMIT 1
    `).bind(siteId, code, siteId, code).first();
    if (!found) return code;
  }
  throw new Error("access_code_generation_failed");
}

function mapOrderStatus(order) {
  const s = String(order?.status || "").toLowerCase();
  const d = String(order?.status_detail || "").toLowerCase();

  if (s === "processed" && d === "accredited") return "approved";
  if (s === "expired") return "expired";
  if (s === "canceled" || s === "cancelled") return "cancelled";
  if (s === "refunded") return "refunded";
  if (s === "failed" || s === "charged_back") return "failed";
  return "pending";
}

function getOrderPayment(order) {
  const p = order?.transactions?.payments;
  return Array.isArray(p) && p.length ? p[0] : null;
}

async function mpFetch(env, path, init = {}) {
  if (!env.MP_ACCESS_TOKEN) {
    throw new Error("MP_ACCESS_TOKEN_not_configured");
  }

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.MP_ACCESS_TOKEN}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${MP_BASE}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { data = { raw: text }; }

  if (!response.ok) {
    const err = new Error(`mercadopago_${response.status}`);
    err.status = response.status;
    err.data = data;
    err.retryAfter = response.headers.get("retry-after");
    throw err;
  }

  return data;
}

async function authenticateRouter(request,env) {
  const token=bearer(request);
  if(!token)return null;

  // Compatibilidade com a RB antiga durante a migração.
  if(env.ROUTER_API_TOKEN&&await secureTextEqual(token,env.ROUTER_API_TOKEN)) {
    return {
      legacy:true,
      routerId:null,
      siteId:env.OPENWIFI_SITE_ID||"openwifi-main",
      tokenSource:"env"
    };
  }

  const hash=await tokenHash(token);
  const row=await env.DB.prepare(`
    SELECT *
      FROM router_devices
     WHERE token_hash=?
     LIMIT 1
  `).bind(hash).first();

  if(!row)return null;

  return {
    legacy:false,
    routerId:row.id,
    siteId:row.site_id,
    router:row,
    tokenSource:"device"
  };
}

async function ensureSite(env, siteId) {
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO sites (id, name, mode, created_at, updated_at)
    VALUES (?, ?, 'standard', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).bind(siteId, "Open Wi-Fi", now, now).run();
}

async function health(env) {
  const row = await env.DB.prepare("SELECT 1 AS ok").first();
  return json({
    ok: row?.ok === 1,
    service: "Open Wi-Fi Cloudflare",
    version: "1.5.0-command-center",
    mercadoPagoConfigured: !!env.MP_ACCESS_TOKEN,
    webhookSecretConfigured: !!env.MP_WEBHOOK_SECRET,
    time: new Date().toISOString(),
  });
}

// ============================================================
// ROUTER / FASE 1.2
// ============================================================
const ROUTER_AGENT_TEMPLATE=String.raw`# Open Wi-Fi Cloudflare v1.3 - SaaS Agent
# RouterOS 7.16.1
#
# IMPORTANTE:
# 1) A credencial individual e lida de openwifi-router.token.
# 2) O scheduler permanece em 10s.
# 3) O script só remove bindings com comment="OpenWiFi Cloud".
# 4) Bindings manuais não são alterados.
# 5) O binding Cloud copia address/to-address do HotSpot host.
# 6) Limites de velocidade usam Simple Queue com comment="OpenWiFi Cloud Queue".
# 7) Filas manuais nunca são removidas.

:local apiUrl "__BASE_URL__/api/router/poll"
:local siteId "__SITE_ID__"
:local routerId "__ROUTER_ID__"
:local token ""
:local tokenFile [/file find where name="openwifi-router.token"]
:if ([:len $tokenFile] = 0) do={
    :log error "OpenWiFi: arquivo de credencial ausente"
    :error "openwifi_token_missing"
}
:set token [/file get $tokenFile contents]

:local hostsJson "["
:local first true

:foreach h in=[/ip hotspot host print as-value] do={

    :local mac ($h->"mac-address")
    :local originalIp ($h->"address")
    :local hotspotIp ($h->"to-address")

    :if ([:len $mac] > 0) do={

        :if ($first = false) do={
            :set hostsJson ($hostsJson . ",")
        }

        :set hostsJson ($hostsJson . \
            "{\"mac\":\"" . $mac . \
            "\",\"ip\":\"" . $hotspotIp . \
            "\",\"originalIp\":\"" . $originalIp . "\"}")

        :set first false
    }
}

:set hostsJson ($hostsJson . "]")

:local identity [/system identity get name]
:local board [/system resource get board-name]
:local version [/system resource get version]
:local architecture [/system resource get architecture-name]
:local serial ""
:do { :set serial [/system routerboard get serial-number] } on-error={ :set serial "" }

:local payload ("{\"siteId\":\"" . $siteId . \
    "\",\"routerId\":\"" . $routerId . \
    "\",\"router\":{\"identity\":\"" . $identity . \
    "\",\"board\":\"" . $board . \
    "\",\"version\":\"" . $version . \
    "\",\"architecture\":\"" . $architecture . \
    "\",\"serial\":\"" . $serial . \
    "\"},\"hosts\":" . $hostsJson . "}")

:local result
:local fetchOk true

:do {

    :set result [/tool fetch \
        url=$apiUrl \
        http-method=post \
        http-header-field=("Authorization: Bearer " . $token . ",Content-Type: application/json") \
        http-data=$payload \
        output=user \
        as-value]

} on-error={

    :set fetchOk false
    :log warning "OpenWiFi Cloud fetch falhou"
}

:if ($fetchOk = true) do={

    :local response
    :local jsonOk true

    :do {
        :set response [:deserialize value=($result->"data") from=json]
    } on-error={
        :set jsonOk false
        :log warning "OpenWiFi Cloud JSON invalido"
    }

    :if ($jsonOk = true) do={

        :local deprovision ($response->"deprovision")

        :if ($deprovision = true) do={

            :log warning "OpenWiFi: integracao revogada pelo painel"

            :foreach bindingId in=[/ip hotspot ip-binding find where comment="OpenWiFi Cloud"] do={
                :local bindingMac [/ip hotspot ip-binding get $bindingId mac-address]

                :foreach activeId in=[/ip hotspot active find where mac-address=$bindingMac] do={
                    /ip hotspot active remove $activeId
                }

                :foreach cookieId in=[/ip hotspot cookie find where mac-address=$bindingMac] do={
                    /ip hotspot cookie remove $cookieId
                }

                /ip hotspot ip-binding remove $bindingId
            }

            :foreach queueId in=[/queue simple find where comment="OpenWiFi Cloud Queue"] do={
                /queue simple remove $queueId
            }

            :do {
                /tool fetch                     url="__BASE_URL__/api/router/install-status"                     http-method=post                     http-header-field=("Authorization: Bearer " . $token . ",Content-Type: application/json")                     http-data="{\"status\":\"deprovisioned\",\"step\":\"stopped\",\"message\":\"Acessos Cloud removidos e agente pausado\"}"                     keep-result=no
            } on-error={}

            :foreach schedulerId in=[/system scheduler find where name="openwifi-cloud-poll"] do={
                /system scheduler disable $schedulerId
            }

            :put "OpenWiFi: integracao desativada"
            :return
        }

        :local access ($response->"access")

        # ============================================================
        # REVOGACAO
        # Remove SOMENTE bindings criados pelo Open Wi-Fi Cloud.
        # Tambem derruba sessao HotSpot/cookie do mesmo MAC.
        # ============================================================

        :foreach bindingId in=[/ip hotspot ip-binding find where comment="OpenWiFi Cloud"] do={

            :local bindingMac [/ip hotspot ip-binding get $bindingId mac-address]
            :local bindingMacText [:tostr $bindingMac]
            :local keep false

            :foreach item in=$access do={

                :local allowedMac ($item->"mac")

                :if ($bindingMacText = $allowedMac) do={
                    :set keep true
                }
            }

            :if ($keep = false) do={

                # Derruba qualquer sessao autenticada do mesmo MAC.
                :foreach activeId in=[/ip hotspot active find where mac-address=$bindingMac] do={
                    /ip hotspot active remove $activeId
                }

                # Remove cookie HotSpot remanescente do mesmo MAC.
                :foreach cookieId in=[/ip hotspot cookie find where mac-address=$bindingMac] do={
                    /ip hotspot cookie remove $cookieId
                }

                /ip hotspot ip-binding remove $bindingId

                :log info ("OpenWiFi Cloud REVOGADO: " . $bindingMacText)
            }
        }

        # ============================================================
        # LIBERACAO
        # Cria bypass somente se nao existir qualquer binding no MAC.
        # Nunca sobrescreve binding manual.
        # ============================================================

        :foreach item in=$access do={

            :local allowedMac ($item->"mac")
            :local downKbps ($item->"downKbps")
            :local upKbps ($item->"upKbps")

            :if ([:typeof $downKbps] = "nil") do={ :set downKbps 0 }
            :if ([:typeof $upKbps] = "nil") do={ :set upKbps 0 }

            # Recupera a tradução real que o HotSpot está usando para esse MAC.
            # Isso é essencial quando address e to-address são diferentes.
            :local hostFound false
            :local originalIp ""
            :local hotspotIp ""

            :foreach hostId in=[/ip hotspot host find where mac-address=$allowedMac] do={
                :if ($hostFound = false) do={
                    :set originalIp [/ip hotspot host get $hostId address]
                    :set hotspotIp [/ip hotspot host get $hostId to-address]
                    :set hostFound true
                }
            }

            :local existing [/ip hotspot ip-binding find where mac-address=$allowedMac]
            :local cloudExisting [/ip hotspot ip-binding find \
                where mac-address=$allowedMac and comment="OpenWiFi Cloud"]

            :if ([:len $existing] = 0) do={

                :if (($hostFound = true) and ([:len $originalIp] > 0) and ([:len $hotspotIp] > 0)) do={

                    /ip hotspot ip-binding add \
                        mac-address=$allowedMac \
                        address=$originalIp \
                        to-address=$hotspotIp \
                        server="openwifi-hotspot" \
                        type=bypassed \
                        comment="OpenWiFi Cloud"

                } else={

                    /ip hotspot ip-binding add \
                        mac-address=$allowedMac \
                        server="openwifi-hotspot" \
                        type=bypassed \
                        comment="OpenWiFi Cloud"
                }

                :log info ("OpenWiFi Cloud LIBERADO: " . $allowedMac)

            } else={

                :if ([:len $cloudExisting] > 0) do={

                    # Se o cliente mudou IP/MAC-private mapping, mantém o binding
                    # Cloud alinhado ao host atual sem tocar em bindings manuais.
                    :if (($hostFound = true) and ([:len $originalIp] > 0) and ([:len $hotspotIp] > 0)) do={

                        :foreach cloudId in=$cloudExisting do={
                            /ip hotspot ip-binding set $cloudId \
                                address=$originalIp \
                                to-address=$hotspotIp
                        }
                    }

                } else={

                    # Existe binding manual para o MAC. Respeita e não sobrescreve.
                }
            }

            # ========================================================
            # VELOCIDADE POR PRODUTO
            # Simple Queue é criada apenas para limites > 0.
            # max-limit usa upload/download no RouterOS.
            # ========================================================

            :local queueName ("OWIFI-" . $allowedMac)
            :local cloudQueue [/queue simple find where name=$queueName and comment="OpenWiFi Cloud Queue"]

            :if (($downKbps > 0) or ($upKbps > 0)) do={

                :if (($hostFound = true) and ([:len $hotspotIp] > 0)) do={

                    :local queueTarget ($hotspotIp . "/32")
                    :local maxLimit (($upKbps . "k") . "/" . ($downKbps . "k"))

                    :if ([:len $cloudQueue] = 0) do={

                        /queue simple add                             name=$queueName                             target=$queueTarget                             max-limit=$maxLimit                             comment="OpenWiFi Cloud Queue"

                    } else={

                        :foreach queueId in=$cloudQueue do={
                            /queue simple set $queueId                                 target=$queueTarget                                 max-limit=$maxLimit
                        }
                    }
                }

            } else={

                :if ([:len $cloudQueue] > 0) do={
                    /queue simple remove $cloudQueue
                }
            }
        }

        # ============================================================
        # LIMPEZA DE FILAS CLOUD
        # Remove fila de MAC que não está mais autorizado/limitado.
        # ============================================================

        :foreach queueId in=[/queue simple find where comment="OpenWiFi Cloud Queue"] do={

            :local queueName [/queue simple get $queueId name]
            :local keepQueue false

            :foreach item in=$access do={

                :local allowedMac ($item->"mac")
                :local downKbps ($item->"downKbps")
                :local upKbps ($item->"upKbps")

                :if ([:typeof $downKbps] = "nil") do={ :set downKbps 0 }
                :if ([:typeof $upKbps] = "nil") do={ :set upKbps 0 }

                :local expectedName ("OWIFI-" . $allowedMac)

                :if (($queueName = $expectedName) and (($downKbps > 0) or ($upKbps > 0))) do={
                    :set keepQueue true
                }
            }

            :if ($keepQueue = false) do={
                /queue simple remove $queueId
            }
        }
    }
}
`;

function buildRouterAgentScript(router,env) {
  const base=String(env.OPENWIFI_BASE_URL||"").replace(/\/$/,"");
  return ROUTER_AGENT_TEMPLATE
    .replaceAll("__BASE_URL__",base)
    .replaceAll("__SITE_ID__",router.site_id)
    .replaceAll("__ROUTER_ID__",router.id);
}

function buildRouterLoginHtml(siteId,env) {
  const base=String(env.OPENWIFI_BASE_URL||"").replace(/\/$/,"");
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${base}/portal?site=${encodeURIComponent(siteId)}&amp;mac=$(mac-esc)&amp;ip=$(ip-esc)">
<title>Open Wi-Fi</title></head>
<body>Abrindo o Open Wi-Fi...</body></html>`;
}

function gatewayCidr(networkCidr,gatewayIp) {
  const prefix=String(networkCidr||"10.77.0.0/24").split("/")[1]||"24";
  return `${gatewayIp}/${prefix}`;
}

function buildEnrollmentBootstrap(enrollmentToken,config,env) {
  const base=String(env.OPENWIFI_BASE_URL||"").replace(/\/$/,"");
  const mode=config.installMode;
  const wan=routerosQuote(config.wanInterface||"ether1");

  return `{
# ============================================================
# OPEN WI-FI v1.3 - BOOTSTRAP DE ADOCAO
# Token temporario: uso unico / expira automaticamente
# Modo: ${mode}
# ============================================================

:local baseUrl "${routerosQuote(base)}"
:local enrollToken "${routerosQuote(enrollmentToken)}"
:local installMode "${routerosQuote(mode)}"
:local wan "${wan}"

:put "OpenWiFi: iniciando adocao..."

# Em instalacao completa, garante DHCP na WAN se ainda nao houver.
:if ($installMode = "full") do={
    :local wanDhcp [/ip dhcp-client find where interface=$wan]
    :if ([:len $wanDhcp] = 0) do={
        /ip dhcp-client add interface=$wan disabled=no use-peer-dns=yes add-default-route=yes comment="OpenWiFi WAN"
        :delay 5s
    } else={
        /ip dhcp-client set $wanDhcp disabled=no
        :delay 2s
    }
}

:local identity [/system identity get name]
:local board [/system resource get board-name]
:local version [/system resource get version]
:local architecture [/system resource get architecture-name]
:local serial ""
:do { :set serial [/system routerboard get serial-number] } on-error={ :set serial "" }

:local payload ("{\\"identity\\":\\"" . $identity . \
    "\\",\\"board\\":\\"" . $board . \
    "\\",\\"version\\":\\"" . $version . \
    "\\",\\"architecture\\":\\"" . $architecture . \
    "\\",\\"serial\\":\\"" . $serial . "\\"}")

:local result
:local enrollOk true
:do {
    :set result [/tool fetch \
        url=($baseUrl . "/api/router/enroll") \
        http-method=post \
        http-header-field=("Authorization: Bearer " . $enrollToken . ",Content-Type: application/json") \
        http-data=$payload \
        output=user \
        as-value]
} on-error={
    :set enrollOk false
    :log error "OpenWiFi: falha ao registrar"
}
:if ($enrollOk = false) do={ :error "openwifi_enroll_failed" }

:local response [:deserialize value=($result->"data") from=json]

:if (($response->"ok") != true) do={
    :log error "OpenWiFi: servidor recusou a adocao"
    :error "openwifi_enroll_rejected"
}

:local routerToken ($response->"routerToken")
:local routerId ($response->"routerId")

:foreach f in=[/file find where name="openwifi-router.token"] do={ /file remove $f }
/file add name="openwifi-router.token" contents=$routerToken

:put ("OpenWiFi: MikroTik registrada: " . $routerId)
:put "OpenWiFi: baixando instalador..."

:foreach f in=[/file find where name="openwifi-installer.rsc"] do={ /file remove $f }

/tool fetch \
    url=($baseUrl . "/api/router/installer.rsc") \
    http-method=get \
    http-header-field=("Authorization: Bearer " . $routerToken) \
    dst-path="openwifi-installer.rsc"

:import file-name="openwifi-installer.rsc"

:put "OpenWiFi: bootstrap concluido."
}
`;
}

function buildRouterInstallerScript(router,env) {
  const base=String(env.OPENWIFI_BASE_URL||"").replace(/\/$/,"");
  let cloudHost="openwifi-api.cauaholiveira06.workers.dev";
  try{cloudHost=new URL(base).hostname||cloudHost}catch{}
  const mode=router.install_mode||"agent";
  const wan=routerosQuote(router.wan_interface||"ether1");
  const lanPorts=safeJsonParse(router.lan_ports_json)||[];
  const portLiteral="{"+lanPorts.map(p=>`"${routerosQuote(p)}"`).join(";")+"}";
  const network=routerosQuote(router.network_cidr||"10.77.0.0/24");
  const gateway=routerosQuote(router.gateway_ip||"10.77.0.1");
  const gatewayWithPrefix=routerosQuote(gatewayCidr(router.network_cidr||"10.77.0.0/24",router.gateway_ip||"10.77.0.1"));
  const pool=routerosQuote(router.pool_range||"10.77.0.10-10.77.0.254");
  const hotspot=routerosQuote(router.hotspot_server||"openwifi-hotspot");
  const siteId=routerosQuote(router.site_id);
  const routerId=routerosQuote(router.id);

  const fullBlock=mode==="full" ? `
        # BRIDGE
        :if ([:len [/interface bridge find where name="bridgeLocal"]] = 0) do={
            /interface bridge add name="bridgeLocal" comment="OpenWiFi Bridge"
        }

        :local lanPorts ${portLiteral}
        :foreach p in=$lanPorts do={
            :local bp [/interface bridge port find where interface=$p]
            :if ([:len $bp] = 0) do={
                /interface bridge port add bridge="bridgeLocal" interface=$p comment="OpenWiFi LAN"
            } else={
                :foreach bpid in=$bp do={
                    /interface bridge port set $bpid bridge="bridgeLocal"
                }
            }
        }

        # Compatibilidade com o firewall padrao da MikroTik.
        :if ([:len [/interface list find where name="LAN"]] > 0) do={
            :if ([:len [/interface list member find where list="LAN" and interface="bridgeLocal"]] = 0) do={
                /interface list member add list="LAN" interface="bridgeLocal" comment="OpenWiFi LAN"
            }
        }

        # IP LAN
        :local lanAddressId [/ip address find where comment="OpenWiFi LAN"]
        :if ([:len $lanAddressId] = 0) do={
            /ip address add address="${gatewayWithPrefix}" interface="bridgeLocal" comment="OpenWiFi LAN"
        } else={
            /ip address set $lanAddressId address="${gatewayWithPrefix}" interface="bridgeLocal"
        }

        # DHCP
        :if ([:len [/ip pool find where name="openwifi-pool"]] = 0) do={
            /ip pool add name="openwifi-pool" ranges="${pool}"
        } else={
            /ip pool set [find where name="openwifi-pool"] ranges="${pool}"
        }

        :if ([:len [/ip dhcp-server find where name="openwifi-dhcp"]] = 0) do={
            /ip dhcp-server add name="openwifi-dhcp" interface="bridgeLocal" address-pool="openwifi-pool" lease-time=1h disabled=no
        } else={
            /ip dhcp-server set [find where name="openwifi-dhcp"] interface="bridgeLocal" address-pool="openwifi-pool" lease-time=1h disabled=no
        }

        :local dhcpNet [/ip dhcp-server network find where address="${network}"]
        :if ([:len $dhcpNet] = 0) do={
            /ip dhcp-server network add address="${network}" gateway="${gateway}" dns-server="${gateway}" comment="OpenWiFi DHCP Network"
        } else={
            /ip dhcp-server network set $dhcpNet gateway="${gateway}" dns-server="${gateway}"
        }

        /ip dns set allow-remote-requests=yes

        # NAT
        :local natId [/ip firewall nat find where comment="OpenWiFi NAT"]
        :if ([:len $natId] = 0) do={
            /ip firewall nat add chain=srcnat out-interface="${wan}" action=masquerade comment="OpenWiFi NAT"
        } else={
            /ip firewall nat set $natId out-interface="${wan}" chain=srcnat action=masquerade
        }

        # HOTSPOT PROFILE
        :if ([:len [/ip hotspot profile find where name="openwifi-profile"]] = 0) do={
            /ip hotspot profile add name="openwifi-profile" hotspot-address="${gateway}" dns-name="login.openwifi.lan" html-directory="hotspot" login-by=cookie,http-chap
        } else={
            /ip hotspot profile set [find where name="openwifi-profile"] hotspot-address="${gateway}" dns-name="login.openwifi.lan" login-by=cookie,http-chap
        }

        # HOTSPOT SERVER
        :if ([:len [/ip hotspot find where name="${hotspot}"]] = 0) do={
            /ip hotspot add name="${hotspot}" interface="bridgeLocal" address-pool="openwifi-pool" profile="openwifi-profile" disabled=no
        } else={
            /ip hotspot set [find where name="${hotspot}"] interface="bridgeLocal" address-pool="openwifi-pool" profile="openwifi-profile" disabled=no
        }
` : "";

  const hotspotBlock=mode!=="agent" ? `
        # WALLED GARDEN DO WORKER
        :foreach id in=[/ip hotspot walled-garden find where comment="OpenWiFi Cloud Portal"] do={ /ip hotspot walled-garden remove $id }
        /ip hotspot walled-garden add server="${hotspot}" dst-host="${routerosQuote(cloudHost)}" action=allow comment="OpenWiFi Cloud Portal"

        :foreach id in=[/ip hotspot walled-garden ip find where comment="OpenWiFi Cloud HTTPS"] do={ /ip hotspot walled-garden ip remove $id }
        /ip hotspot walled-garden ip add action=accept server="${hotspot}" protocol=tcp dst-host="${routerosQuote(cloudHost)}" dst-port=443 comment="OpenWiFi Cloud HTTPS"

        # Descobre o diretorio HTML do profile atualmente usado pelo HotSpot.
        :local hsId [/ip hotspot find where name="${hotspot}"]
        :if ([:len $hsId] = 0) do={ :error "openwifi_hotspot_server_not_found" }
        :local hsProfile [/ip hotspot get $hsId profile]
        :local htmlDir [/ip hotspot profile get [find where name=$hsProfile] html-directory]
        :if ([:len $htmlDir] = 0) do={ :set htmlDir "hotspot" }
        :local loginPath ($htmlDir . "/login.html")

        /tool fetch \
            url=($baseUrl . "/api/router/login.html?site=${siteId}") \
            http-method=get \
            dst-path=$loginPath
` : "";

  return `# ============================================================
# OPEN WI-FI v1.3 - INSTALADOR GERENCIADO
# Router ID: ${routerId}
# Modo: ${mode}
# ============================================================

:local baseUrl "${routerosQuote(base)}"
:local routerId "${routerId}"
:local siteId "${siteId}"
:local tokenFile [/file find where name="openwifi-router.token"]
:if ([:len $tokenFile] = 0) do={ :error "openwifi_token_missing" }
:local token [/file get $tokenFile contents]

:local installOk true

:do {

        # Marca instalacao em andamento.
        /tool fetch url=($baseUrl . "/api/router/install-status") http-method=post \
            http-header-field=("Authorization: Bearer " . $token . ",Content-Type: application/json") \
            http-data="{\\"status\\":\\"installing\\",\\"step\\":\\"config\\",\\"message\\":\\"Configurando MikroTik\\"}" \
            keep-result=no

${fullBlock}
${hotspotBlock}

        # AGENTE CLOUD
        :foreach f in=[/file find where name="openwifi-agent.txt"] do={ /file remove $f }
        /tool fetch \
            url=($baseUrl . "/api/router/agent.rsc") \
            http-method=get \
            http-header-field=("Authorization: Bearer " . $token) \
            dst-path="openwifi-agent.txt"

        :local agentSource [/file get [find where name="openwifi-agent.txt"] contents]

        # Troca segura do agente. Em RB ja configurada, preserva o agente anterior
        # como backup em vez de tentar alterar o source do script em execucao.
        :local oldAgent [/system script find where name="openwifi-cloud-poll"]
        :local hadOld false

        :if ([:len $oldAgent] > 0) do={
            :set hadOld true
            :foreach sid in=[/system scheduler find where name="openwifi-cloud-poll"] do={
                /system scheduler disable $sid
            }
            :foreach bid in=[/system script find where name="openwifi-cloud-poll-backup"] do={
                /system script remove $bid
            }
            /system script set $oldAgent name="openwifi-cloud-poll-backup"
        }

        :do {
            /system script add name="openwifi-cloud-poll" source=$agentSource policy=read,write,policy,test,password,sensitive
        } on-error={
            :if ($hadOld = true) do={
                :foreach bid in=[/system script find where name="openwifi-cloud-poll-backup"] do={
                    /system script set $bid name="openwifi-cloud-poll"
                }
            }
            :error "openwifi_agent_install_failed"
        }

        :if ([:len [/system scheduler find where name="openwifi-cloud-poll"]] = 0) do={
            /system scheduler add name="openwifi-cloud-poll" interval=10s start-time=startup on-event="openwifi-cloud-poll" policy=read,write,policy,test,password,sensitive disabled=no
        } else={
            /system scheduler set [find where name="openwifi-cloud-poll"] interval=10s on-event="openwifi-cloud-poll" policy=read,write,policy,test,password,sensitive disabled=no
        }

        /system script run openwifi-cloud-poll

} on-error={
    :set installOk false
    :log error "OpenWiFi: instalacao falhou"

    :do {
        /tool fetch url=($baseUrl . "/api/router/install-status") http-method=post \
            http-header-field=("Authorization: Bearer " . $token . ",Content-Type: application/json") \
            http-data="{\\\"status\\\":\\\"failed\\\",\\\"step\\\":\\\"config\\\",\\\"message\\\":\\\"Falha durante a configuracao; consulte o log da MikroTik\\\"}" \
            keep-result=no
    } on-error={}
}

:if ($installOk = true) do={
    /tool fetch url=($baseUrl . "/api/router/install-status") http-method=post \
        http-header-field=("Authorization: Bearer " . $token . ",Content-Type: application/json") \
        http-data="{\\"status\\":\\"installed\\",\\"step\\":\\"complete\\",\\"message\\":\\"Instalacao concluida\\"}" \
        keep-result=no

    :log info "OpenWiFi: instalacao concluida"
    :put "OpenWiFi: INSTALACAO CONCLUIDA"
}
`;
}

async function routerEnroll(request,env) {
  const enrollmentToken=bearer(request);
  if(!enrollmentToken)return json({ok:false,error:"enrollment_token_required"},401);

  const hash=await tokenHash(enrollmentToken);
  const now=Date.now();

  const enrollment=await env.DB.prepare(`
    SELECT *
      FROM router_enrollments
     WHERE token_hash=? AND used_at IS NULL AND expires_at>?
     LIMIT 1
  `).bind(hash,now).first();

  if(!enrollment)return json({ok:false,error:"enrollment_invalid_or_expired"},401);

  let body;
  try{body=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}

  const permanentToken=randomToken(32);
  const permanentHash=await tokenHash(permanentToken);
  const routerId=uuid();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO router_devices(
        id,site_id,name,token_hash,enabled,install_mode,install_status,install_step,
        wan_interface,lan_ports_json,network_cidr,gateway_ip,pool_range,hotspot_server,
        identity,board,version,architecture,serial_number,last_public_ip,last_seen_at,
        enrolled_at,created_at,updated_at
      )
      VALUES(?,?,?,?,1,?,'enrolled','enroll',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      routerId,enrollment.site_id,enrollment.router_name,permanentHash,
      enrollment.install_mode,enrollment.wan_interface,enrollment.lan_ports_json,
      enrollment.network_cidr,enrollment.gateway_ip,enrollment.pool_range,
      enrollment.hotspot_server,
      String(body.identity||"").slice(0,100)||null,
      String(body.board||"").slice(0,100)||null,
      String(body.version||"").slice(0,100)||null,
      String(body.architecture||"").slice(0,100)||null,
      String(body.serial||"").slice(0,100)||null,
      request.headers.get("cf-connecting-ip")||null,
      now,now,now,now
    ),
    env.DB.prepare(`
      UPDATE router_enrollments
         SET used_at=?,router_id=?
       WHERE id=?
    `).bind(now,routerId,enrollment.id)
  ]);

  await audit(env,enrollment.site_id,"router.enroll",{
    routerId,name:enrollment.router_name,mode:enrollment.install_mode,
    board:body.board||null,version:body.version||null
  });

  return json({
    ok:true,
    routerId,
    siteId:enrollment.site_id,
    routerToken:permanentToken,
    installMode:enrollment.install_mode,
    installerUrl:`${String(env.OPENWIFI_BASE_URL||"").replace(/\/$/,"")}/api/router/installer.rsc`
  });
}

async function routerInstallerRsc(request,env) {
  const auth=await authenticateRouter(request,env);
  if(!auth||auth.legacy)return new Response("unauthorized",{status:401});

  const router=await env.DB.prepare(`
    SELECT * FROM router_devices WHERE id=?
  `).bind(auth.routerId).first();
  if(!router)return new Response("router_not_found",{status:404});
  if(!router.enabled)return new Response("router_disabled",{status:403});

  return new Response(buildRouterInstallerScript(router,env),{
    headers:{
      "content-type":"text/plain; charset=utf-8",
      "cache-control":"no-store",
      "content-disposition":'inline; filename="openwifi-installer.rsc"'
    }
  });
}

async function routerAgentRsc(request,env) {
  const auth=await authenticateRouter(request,env);
  if(!auth||auth.legacy)return new Response("unauthorized",{status:401});

  const router=await env.DB.prepare(`
    SELECT * FROM router_devices WHERE id=?
  `).bind(auth.routerId).first();
  if(!router)return new Response("router_not_found",{status:404});
  if(!router.enabled)return new Response("router_disabled",{status:403});

  return new Response(buildRouterAgentScript(router,env),{
    headers:{
      "content-type":"text/plain; charset=utf-8",
      "cache-control":"no-store",
      "content-disposition":'inline; filename="openwifi-agent.rsc"'
    }
  });
}

async function routerLoginHtml(url,env) {
  const siteId=String(url.searchParams.get("site")||env.OPENWIFI_SITE_ID||"openwifi-main");
  return new Response(buildRouterLoginHtml(siteId,env),{
    headers:{"content-type":"text/html; charset=utf-8","cache-control":"public, max-age=300"}
  });
}

async function routerInstallStatus(request,env) {
  const auth=await authenticateRouter(request,env);
  if(!auth||auth.legacy)return json({ok:false,error:"unauthorized"},401);

  let b;
  try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}

  const status=["enrolled","installing","installed","failed","online","revoking","deprovisioned"].includes(b.status)
    ?b.status:"installing";
  const step=String(b.step||"").slice(0,80)||null;
  const message=String(b.message||"").slice(0,500)||null;
  const now=Date.now();

  await env.DB.prepare(`
    UPDATE router_devices
       SET install_status=?,install_step=?,install_message=?,
           installed_at=CASE WHEN ?='installed' THEN COALESCE(installed_at,?) ELSE installed_at END,
           updated_at=?
     WHERE id=?
  `).bind(status,step,message,status,now,now,auth.routerId).run();

  return json({ok:true});
}

async function adminRouters(env) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const now=Date.now();
  const offlineAfter=Number(env.ROUTER_OFFLINE_AFTER_MS||90000);

  const rows=await env.DB.prepare(`
    SELECT id,site_id,name,enabled,install_mode,install_status,install_step,install_message,
           wan_interface,lan_ports_json,network_cidr,gateway_ip,pool_range,hotspot_server,
           identity,board,version,architecture,serial_number,last_public_ip,last_seen_at,
           enrolled_at,installed_at,created_at,updated_at
      FROM router_devices
     WHERE site_id=?
     ORDER BY created_at DESC
  `).bind(siteId).all();

  const pending=await env.DB.prepare(`
    SELECT id,router_name,install_mode,expires_at,created_at
      FROM router_enrollments
     WHERE site_id=? AND used_at IS NULL AND expires_at>?
     ORDER BY created_at DESC
     LIMIT 20
  `).bind(siteId,now).all();

  return json({
    ok:true,
    routers:rows.results.map(r=>({
      ...r,
      online:!!r.enabled&&!!r.last_seen_at&&now-Number(r.last_seen_at)<=offlineAfter,
      ageMs:r.last_seen_at?now-Number(r.last_seen_at):null,
      lanPorts:safeJsonParse(r.lan_ports_json)||[]
    })),
    pendingEnrollments:pending.results,
    offlineAfterMs:offlineAfter,
    generatedAt:now
  });
}

async function adminCreateRouterEnrollment(request,env) {
  let b;
  try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}

  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const installMode=["full","hotspot","agent"].includes(b.installMode)?b.installMode:"agent";
  const name=safeRouterName(b.name,"Nova MikroTik");
  const wan=validRouterIdentifier(b.wanInterface)?String(b.wanInterface):"ether1";
  const hotspot=validRouterIdentifier(b.hotspotServer)?String(b.hotspotServer):"openwifi-hotspot";

  let lanPorts=Array.isArray(b.lanPorts)?b.lanPorts:[];
  lanPorts=[...new Set(lanPorts.map(x=>String(x||"").trim()).filter(validRouterIdentifier))].slice(0,32);

  const network=validCidr(b.networkCidr)?String(b.networkCidr):"10.77.0.0/24";
  const gateway=validIpv4(b.gatewayIp)?String(b.gatewayIp):"10.77.0.1";
  const pool=/^\d{1,3}(?:\.\d{1,3}){3}-\d{1,3}(?:\.\d{1,3}){3}$/.test(String(b.poolRange||""))
    ?String(b.poolRange)
    :"10.77.0.10-10.77.0.254";

  if(installMode==="full"&&!lanPorts.length) {
    return json({ok:false,error:"lan_ports_required_for_full_install"},400);
  }

  const now=Date.now();
  const expiresAt=now+15*60*1000;
  const token=randomToken(32);
  const hash=await tokenHash(token);
  const id=uuid();

  await env.DB.prepare(`
    INSERT INTO router_enrollments(
      id,site_id,router_name,token_hash,install_mode,wan_interface,lan_ports_json,
      network_cidr,gateway_ip,pool_range,hotspot_server,expires_at,created_at
    )
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id,siteId,name,hash,installMode,wan,JSON.stringify(lanPorts),
    network,gateway,pool,hotspot,expiresAt,now
  ).run();

  await audit(env,siteId,"router.enrollment.create",{
    enrollmentId:id,name,installMode,wan,lanPorts,expiresAt
  });

  return json({
    ok:true,
    enrollmentId:id,
    expiresAt,
    installMode,
    bootstrapScript:buildEnrollmentBootstrap(token,{
      installMode,wanInterface:wan
    },env)
  });
}

async function adminRouterDisable(env,id) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const now=Date.now();
  const row=await env.DB.prepare(`
    SELECT id,name,enabled FROM router_devices WHERE id=? AND site_id=?
  `).bind(id,siteId).first();
  if(!row)return json({ok:false,error:"router_not_found"},404);

  await env.DB.prepare(`
    UPDATE router_devices
       SET enabled=0,install_status='revoking',install_step='deprovision',
           install_message='Aguardando a MikroTik limpar acessos e parar o agente',
           updated_at=?
     WHERE id=? AND site_id=?
  `).bind(now,id,siteId).run();

  await audit(env,siteId,"router.disable",{routerId:id,name:row.name});
  return json({ok:true});
}

async function adminRouterDelete(env,id) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const row=await env.DB.prepare(`
    SELECT name,install_status,last_seen_at FROM router_devices WHERE id=? AND site_id=?
  `).bind(id,siteId).first();
  if(!row)return json({ok:false,error:"router_not_found"},404);

  if(row.last_seen_at && row.install_status!=="deprovisioned") {
    return json({ok:false,error:"router_must_be_deprovisioned_first"},409);
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM router_enrollments WHERE router_id=? AND site_id=?`).bind(id,siteId),
    env.DB.prepare(`UPDATE router_hosts SET last_router_id=NULL WHERE site_id=? AND last_router_id=?`).bind(siteId,id),
    env.DB.prepare(`DELETE FROM router_devices WHERE id=? AND site_id=?`).bind(id,siteId)
  ]);

  await audit(env,siteId,"router.delete",{routerId:id,name:row.name});
  return json({ok:true});
}


async function syncRouterHosts(env, siteId, routerId, incomingHosts, now) {
  const touchMs = Number(env.ROUTER_HOST_TOUCH_MS || 1800000);

  const stored = await env.DB.prepare(`
    SELECT mac, ip, hostname, last_seen_at, last_router_id
      FROM router_hosts
     WHERE site_id = ?
  `).bind(siteId).all();

  const existing = new Map(
    stored.results.map((r) => [
      normalizeMac(r.mac),
      {
        mac: normalizeMac(r.mac),
        ip: r.ip || null,
        hostname: r.hostname || null,
        last_seen_at: Number(r.last_seen_at || 0),
        last_router_id: r.last_router_id || null,
      },
    ])
  );

  const incoming = new Map();

  for (const raw of incomingHosts) {
    const mac = normalizeMac(raw?.mac);
    if (!validMac(mac)) continue;

    incoming.set(mac, {
      mac,
      ip: raw?.ip ? String(raw.ip) : null,
      hostname: raw?.hostname ? String(raw.hostname).slice(0, 255) : null,
    });
  }

  const statements = [];

  for (const [mac, host] of incoming) {
    const old = existing.get(mac);

    if (!old) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO router_hosts (site_id, mac, ip, hostname, last_seen_at, last_router_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(siteId, mac, host.ip, host.hostname, now, routerId)
      );
      continue;
    }

    const changed =
      old.ip !== host.ip ||
      (host.hostname && old.hostname !== host.hostname);

    const touchDue = now - old.last_seen_at >= touchMs;

    if (changed || touchDue) {
      statements.push(
        env.DB.prepare(`
          UPDATE router_hosts
             SET ip = ?,
                 hostname = COALESCE(?, hostname),
                 last_seen_at = ?,
                 last_router_id = ?
           WHERE site_id = ? AND mac = ?
        `).bind(host.ip, host.hostname, now, routerId, siteId, mac)
      );
    }
  }

  for (const [mac,old] of existing) {
    if (!incoming.has(mac) && old.last_router_id===routerId) {
      statements.push(
        env.DB.prepare(`
          DELETE FROM router_hosts
           WHERE site_id = ? AND mac = ? AND last_router_id = ?
        `).bind(siteId, mac, routerId)
      );
    }
  }

  if (statements.length) {
    await env.DB.batch(statements.slice(0, 20));
  }

  return {
    incomingCount: incoming.size,
    changesQueued: statements.length,
    changesApplied: Math.min(statements.length, 20),
  };
}

async function routerPoll(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const auth=await authenticateRouter(request,env);
  if(!auth)return json({ok:false,error:"unauthorized"},401);

  const siteId=String(body.siteId||auth.siteId||env.OPENWIFI_SITE_ID||"").trim();
  if(!siteId)return json({ok:false,error:"site_id_required"},400);
  if(!auth.legacy&&siteId!==auth.siteId)return json({ok:false,error:"router_site_mismatch"},403);
  if(!auth.legacy&&body.routerId&&String(body.routerId)!==auth.routerId) {
    return json({ok:false,error:"router_id_mismatch"},403);
  }

  const routerId=auth.routerId||"legacy";

  if(!auth.legacy&&!auth.router.enabled) {
    const now=Date.now();
    await env.DB.prepare(`
      UPDATE router_devices
         SET last_seen_at=?,last_public_ip=?,updated_at=?
       WHERE id=?
    `).bind(now,request.headers.get("cf-connecting-ip")||null,now,auth.routerId).run();

    return json({
      ok:true,
      siteId,
      routerId:auth.routerId,
      serverTime:now,
      pollAfterMs:10000,
      deprovision:true,
      access:[],
      commands:[{type:"deprovision"}]
    });
  }

  await ensureSite(env,siteId);

  const now = Date.now();
  const heartbeatMs = Number(env.ROUTER_HEARTBEAT_MS || 30000);
  const hosts = Array.isArray(body.hosts) ? body.hosts.slice(0, 2000) : [];

  const site = await env.DB.prepare(`
    SELECT router_last_seen_at
      FROM sites
     WHERE id = ?
  `).bind(siteId).first();

  // Cada MikroTik possui seu próprio relógio de heartbeat.
  // A RB antiga continua usando o heartbeat agregado do site.
  const lastSeen = auth.legacy
    ?Number(site?.router_last_seen_at||0)
    :Number(auth.router?.last_seen_at||0);
  const heartbeatDue=!lastSeen||(now-lastSeen>=heartbeatMs);

  if(!auth.legacy) {
    await env.DB.prepare(`
      UPDATE router_devices
         SET identity=?,
             board=?,
             version=?,
             architecture=COALESCE(?,architecture),
             serial_number=COALESCE(?,serial_number),
             last_public_ip=?,
             last_seen_at=?,
             install_status=CASE
               WHEN install_status IN ('enrolled','installing') THEN install_status
               ELSE 'online'
             END,
             updated_at=?
       WHERE id=? AND site_id=?
    `).bind(
      body.router?.identity||null,
      body.router?.board||null,
      body.router?.version||null,
      body.router?.architecture||null,
      body.router?.serial||null,
      request.headers.get("cf-connecting-ip")||null,
      now,now,auth.routerId,siteId
    ).run();
  }

  let hostSync = null;

  if(heartbeatDue) {
    hostSync=await syncRouterHosts(env,siteId,routerId,hosts,now);

    const totalHosts=await env.DB.prepare(`
      SELECT COUNT(*) AS c FROM router_hosts WHERE site_id=?
    `).bind(siteId).first();

    await env.DB.prepare(`
      UPDATE sites
         SET router_last_seen_at=?,
             router_version=?,
             router_board=?,
             router_identity=?,
             router_host_count=?,
             updated_at=?
       WHERE id=?
    `).bind(
      now,
      body.router?.version||null,
      body.router?.board||null,
      body.router?.identity||null,
      Number(totalHosts?.c||0),
      now,
      siteId
    ).run();
  }

  await env.DB.prepare(`
    UPDATE access_grants
       SET status = 'expired',
           updated_at = ?
     WHERE site_id = ?
       AND status = 'active'
       AND ends_at <= ?
  `).bind(now, siteId, now).run();

  // Inicia agora qualquer janela de 30 s que estava aguardando a RB.
  await startWaitingAttemptsOnRouterPoll(env, siteId, now);

  await expireAttemptRows(env, siteId, now);

  const active = await env.DB.prepare(`
    SELECT mac,
           MAX(ends_at) AS ends_at,
           MAX(down_kbps) AS down_kbps,
           MAX(up_kbps) AS up_kbps
      FROM (
        SELECT dm.mac AS mac,
               ag.ends_at AS ends_at,
               COALESCE(ag.rate_limit_down_kbps,0) AS down_kbps,
               COALESCE(ag.rate_limit_up_kbps,0) AS up_kbps
          FROM access_grants ag
          JOIN device_macs dm
            ON dm.device_id=ag.device_id
           AND dm.site_id=ag.site_id
         WHERE ag.site_id=?
           AND ag.status='active'
           AND ag.starts_at<=?
           AND ag.ends_at>?

        UNION ALL

        SELECT aa.mac AS mac,
               aa.ends_at AS ends_at,
               0 AS down_kbps,
               0 AS up_kbps
          FROM access_attempts aa
         WHERE aa.site_id=?
           AND aa.status='active'
           AND aa.router_started_at IS NOT NULL
           AND aa.starts_at<=?
           AND aa.ends_at>?
      )
     GROUP BY mac
     ORDER BY ends_at ASC
  `).bind(siteId,now,now,siteId,now,now).all();

  return json({
    ok: true,
    siteId,
    routerId:auth.routerId||null,
    serverTime: now,
    pollAfterMs: 10000,
    heartbeatPersisted: heartbeatDue,
    hostSync,
    access: active.results.map((r) => ({
      mac:normalizeMac(r.mac),
      until:Number(r.ends_at),
      downKbps:Number(r.down_kbps||0),
      upKbps:Number(r.up_kbps||0),
    })),
    commands: [],
  });
}

async function siteStatus(env) {
  const siteId = env.OPENWIFI_SITE_ID || "openwifi-main";

  const site = await env.DB.prepare(`
    SELECT id, name, mode, router_last_seen_at, router_version,
           router_board, router_identity, router_host_count, updated_at
      FROM sites
     WHERE id = ?
  `).bind(siteId).first();

  const now = Date.now();
  const offlineAfter = Number(env.ROUTER_OFFLINE_AFTER_MS || 90000);

  return json({
    ok: true,
    site: site
      ? {
          ...site,
          routerOnline:
            !!site.router_last_seen_at &&
            now - Number(site.router_last_seen_at) <= offlineAfter,
          routerAgeMs: site.router_last_seen_at
            ? now - Number(site.router_last_seen_at)
            : null,
        }
      : null,
  });
}

// ============================================================
// DEVICE / PORTAL
// ============================================================

async function validateCurrentRouterHost(env, siteId, mac) {
  const row = await env.DB.prepare(`
    SELECT mac, ip, hostname
      FROM router_hosts
     WHERE site_id = ?
       AND mac = ?
  `).bind(siteId, normalizeMac(mac)).first();

  return row || null;
}

async function registerDevice(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const siteId = String(body.siteId || env.OPENWIFI_SITE_ID || "").trim();
  const mac = normalizeMac(body.mac);
  const proposedId = String(body.deviceId || "").trim();

  if (!siteId || !validMac(mac)) {
    return json({ ok: false, error: "invalid_device" }, 400);
  }

  const host = await validateCurrentRouterHost(env, siteId, mac);
  if (!host) {
    return json({
      ok: false,
      error: "device_not_seen_by_router",
      message: "Este aparelho ainda não foi identificado pela rede Open Wi-Fi.",
    }, 403);
  }

  const existing = await env.DB.prepare(`
    SELECT dm.device_id, d.hostname
      FROM device_macs dm
      JOIN devices d ON d.id = dm.device_id
     WHERE dm.site_id = ?
       AND dm.mac = ?
  `).bind(siteId, mac).first();

  const now = Date.now();
  let deviceId = existing?.device_id || proposedId || uuid();

  if (!existing) {
    await env.DB.prepare(`
      INSERT INTO devices (id, site_id, hostname, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        hostname = COALESCE(excluded.hostname, devices.hostname),
        updated_at = excluded.updated_at
    `).bind(deviceId, siteId, host.hostname || null, now, now).run();

    await env.DB.prepare(`
      INSERT INTO device_macs (site_id, mac, device_id, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(site_id, mac) DO UPDATE SET
        last_seen_at = excluded.last_seen_at
    `).bind(siteId, mac, deviceId, now, now).run();
  } else {
    await env.DB.prepare(`
      UPDATE device_macs SET last_seen_at = ?
       WHERE site_id = ? AND mac = ?
    `).bind(now, siteId, mac).run();
  }

  const visitBucket=Math.floor(now/300000);
  await env.DB.prepare(`
    INSERT INTO portal_visits(id,site_id,device_id,mac,visit_bucket,visited_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(site_id,device_id,visit_bucket) DO NOTHING
  `).bind(uuid(),siteId,deviceId,mac,visitBucket,now).run();

  const grant = await env.DB.prepare(`
    SELECT ends_at
      FROM access_grants
     WHERE site_id = ?
       AND device_id = ?
       AND status = 'active'
       AND ends_at > ?
     ORDER BY ends_at DESC
     LIMIT 1
  `).bind(siteId, deviceId, now).first();

  return json({
    ok: true,
    deviceId,
    mac,
    activeUntil: grant?.ends_at || null,
  });
}

async function listPlans(url, env) {
  const siteId = String(url.searchParams.get("site") || env.OPENWIFI_SITE_ID || "");
  const site = await env.DB.prepare(`
    SELECT id, name, mode, active_event_id, background_mode, background_image_url,
           support_whatsapp, require_whatsapp_standard, sales_enabled,
           portal_title, portal_subtitle, about_title, about_text, logo_image_url,
           notice_enabled,notice_title,notice_text,notice_starts_at,notice_ends_at,
           emergency_message,privacy_title,privacy_text,privacy_require_accept,
           privacy_policy_version
      FROM sites WHERE id = ?
  `).bind(siteId).first();

  if (!site) return json({ ok: false, error: "site_not_found" }, 404);

  let event = null;
  if (site.active_event_id) {
    event = await env.DB.prepare(`
      SELECT id, name, starts_at, ends_at, status
        FROM events
       WHERE id = ? AND site_id = ?
    `).bind(site.active_event_id, siteId).first();
  }

  const now = Date.now();
  let eventState = null;
  if (event) {
    eventState = now < event.starts_at ? "scheduled" :
      now >= event.ends_at ? "ended" : "active";
  }

  const modes = site.mode === "party" ? ["party", "both"] : ["standard", "both"];
  const plans = await env.DB.prepare(`
    SELECT id, slug, name, price_cents, duration_seconds, party_until_event_end,
           max_devices, sort_order, mode,rate_limit_down_kbps,rate_limit_up_kbps
      FROM plans
     WHERE site_id = ?
       AND enabled = 1
       AND mode IN (?, ?)
     ORDER BY sort_order, price_cents
  `).bind(siteId, modes[0], modes[1]).all();

  return json({
    ok: true,
    site: {
      id: site.id, name: site.name, mode: site.mode,
      salesEnabled: !!site.sales_enabled,
      backgroundMode: site.background_mode || "gradient",
      backgroundImageUrl: site.background_image_url || null,
      supportWhatsapp: site.support_whatsapp || null,
      requireWhatsappStandard: !!site.require_whatsapp_standard,
      portalTitle: site.portal_title || "Open Wi-Fi",
      portalSubtitle: site.portal_subtitle || "",
      aboutTitle: site.about_title || "Conheça o Open Wi-Fi",
      aboutText: site.about_text || "",
      logoConfigured: !!site.logo_image_url,
      notice: (
        site.notice_enabled &&
        (!site.notice_starts_at || now>=Number(site.notice_starts_at)) &&
        (!site.notice_ends_at || now<Number(site.notice_ends_at))
      ) ? {
        title:site.notice_title||"Aviso",
        text:site.notice_text||""
      } : null,
      emergencyMessage:site.emergency_message||"Novas vendas temporariamente pausadas.",
      privacy:{
        title:site.privacy_title||"Privacidade e uso de dados",
        text:site.privacy_text||"",
        requireAccept:!!site.privacy_require_accept,
        version:Number(site.privacy_policy_version||1)
      }
    },
    event: event ? { ...event, state: eventState } : null,
    plans: plans.results,
  });
}

// ============================================================
// JANELAS TEMPORÁRIAS / ANTI-ABUSO
// ============================================================

async function startWaitingAttemptsOnRouterPoll(env, siteId, now) {
  const windowMs = Number(env.ATTEMPT_WINDOW_MS || 30000);
  const cooldownMs = Number(env.COOLDOWN_MS || 600000);
  const maxAttempts = Number(env.MAX_ATTEMPTS || 3);

  // A janela foi solicitada pelo celular, mas o relógio de 30 s só começa
  // quando a própria RB faz este poll e passa a receber o MAC em "access".
  await env.DB.prepare(`
    UPDATE access_attempts
       SET router_started_at = ?,
           starts_at = ?,
           ends_at = ?,
           updated_at = ?
     WHERE site_id = ?
       AND status = 'active'
       AND router_started_at IS NULL
       AND ends_at > ?
  `).bind(
    now,
    now,
    now + windowMs,
    now,
    siteId,
    now
  ).run();

  // Na terceira tentativa, reposiciona o cooldown a partir do fim REAL
  // da janela que acabou de ser iniciada pela MikroTik.
  await env.DB.prepare(`
    UPDATE attempt_limits
       SET cooldown_until = (
             SELECT aa.ends_at + ?
               FROM access_attempts aa
              WHERE aa.site_id = attempt_limits.site_id
                AND aa.device_id = attempt_limits.device_id
                AND aa.status = 'active'
                AND aa.router_started_at = ?
                AND aa.attempt_number >= ?
              ORDER BY aa.router_started_at DESC
              LIMIT 1
           ),
           updated_at = ?
     WHERE site_id = ?
       AND EXISTS (
             SELECT 1
               FROM access_attempts aa
              WHERE aa.site_id = attempt_limits.site_id
                AND aa.device_id = attempt_limits.device_id
                AND aa.status = 'active'
                AND aa.router_started_at = ?
                AND aa.attempt_number >= ?
           )
  `).bind(
    cooldownMs,
    now,
    maxAttempts,
    now,
    siteId,
    now,
    maxAttempts
  ).run();
}

async function expireAttemptRows(env, siteId, now) {
  await env.DB.prepare(`
    UPDATE access_attempts
       SET status = 'expired',
           updated_at = ?
     WHERE site_id = ?
       AND status = 'active'
       AND ends_at <= ?
  `).bind(now, siteId, now).run();
}

async function getAttemptState(env, siteId, deviceId, paymentId = null) {
  const now = Date.now();

  const limit = await env.DB.prepare(`
    SELECT attempts_used, cooldown_until, last_attempt_started_at
      FROM attempt_limits
     WHERE site_id = ?
       AND device_id = ?
  `).bind(siteId, deviceId).first();

  let active = null;

  if (paymentId) {
    active = await env.DB.prepare(`
      SELECT id, payment_id, mac, attempt_number, starts_at, ends_at, status,
             router_started_at
        FROM access_attempts
       WHERE site_id = ?
         AND device_id = ?
         AND payment_id = ?
         AND status = 'active'
         AND ends_at > ?
       ORDER BY starts_at DESC
       LIMIT 1
    `).bind(siteId, deviceId, paymentId, now).first();
  } else {
    active = await env.DB.prepare(`
      SELECT id, payment_id, mac, attempt_number, starts_at, ends_at, status,
             router_started_at
        FROM access_attempts
       WHERE site_id = ?
         AND device_id = ?
         AND status = 'active'
         AND ends_at > ?
       ORDER BY starts_at DESC
       LIMIT 1
    `).bind(siteId, deviceId, now).first();
  }

  const maxAttempts = Number(env.MAX_ATTEMPTS || 3);
  const attemptsUsed = Number(limit?.attempts_used || 0);
  const cooldownUntil = Number(limit?.cooldown_until || 0) || null;

  const waitingRouter = !!active && !active.router_started_at;

  return {
    attemptsUsed,
    attemptsRemaining: Math.max(0, maxAttempts - attemptsUsed),
    maxAttempts,
    waitingRouter,
    activeUntil: active && active.router_started_at ? Number(active.ends_at) : null,
    activeAttemptNumber: active ? Number(active.attempt_number) : null,
    cooldownUntil,
    inCooldown: !!cooldownUntil && cooldownUntil > now && !active,
  };
}

async function startAttemptWindow(env, payment, mac) {
  const now = Date.now();
  const windowMs = Number(env.ATTEMPT_WINDOW_MS || 30000);
  const routerWaitMs = Number(env.ATTEMPT_ROUTER_WAIT_MS || 60000);
  const maxAttempts = Number(env.MAX_ATTEMPTS || 3);
  const cooldownMs = Number(env.COOLDOWN_MS || 600000);

  // endsAt é provisório enquanto aguardamos a RB.
  // No primeiro routerPoll ele é substituído por now + ATTEMPT_WINDOW_MS.
  const endsAt = now + routerWaitMs;

  if (payment.status === "approved") {
    return {
      ok: false,
      error: "payment_already_approved",
      state: await getAttemptState(env, payment.site_id, payment.device_id, payment.id),
    };
  }

  if (payment.status !== "pending") {
    return {
      ok: false,
      error: "payment_not_pending",
      state: await getAttemptState(env, payment.site_id, payment.device_id, payment.id),
    };
  }

  // Expira logicamente janelas antigas antes de criar outra.
  await expireAttemptRows(env, payment.site_id, now);

  // Se já existe uma janela ainda válida deste pagamento, reaproveita.
  const active = await env.DB.prepare(`
    SELECT id, attempt_number, starts_at, ends_at
      FROM access_attempts
     WHERE site_id = ?
       AND device_id = ?
       AND payment_id = ?
       AND status = 'active'
       AND ends_at > ?
     LIMIT 1
  `).bind(payment.site_id, payment.device_id, payment.id, now).first();

  if (active) {
    return {
      ok: true,
      reused: true,
      state: await getAttemptState(env, payment.site_id, payment.device_id, payment.id),
    };
  }

  const requestId = uuid();
  const attemptId = uuid();

  // batch() é transacional no D1. Usamos last_request_id para impedir que
  // uma requisição concorrente "roube" o incremento de outra.
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE attempt_limits
         SET attempts_used = 0,
             cooldown_until = NULL,
             last_request_id = NULL,
             updated_at = ?
       WHERE site_id = ?
         AND device_id = ?
         AND cooldown_until IS NOT NULL
         AND cooldown_until <= ?
    `).bind(now, payment.site_id, payment.device_id, now),

    env.DB.prepare(`
      INSERT INTO attempt_limits
        (site_id, device_id, attempts_used, cooldown_until,
         last_attempt_started_at, last_request_id, updated_at)
      VALUES (?, ?, 0, NULL, NULL, NULL, ?)
      ON CONFLICT(site_id, device_id) DO NOTHING
    `).bind(payment.site_id, payment.device_id, now),

    env.DB.prepare(`
      UPDATE attempt_limits
         SET attempts_used = attempts_used + 1,
             cooldown_until = CASE
               WHEN attempts_used + 1 >= ?
               THEN ?
               ELSE NULL
             END,
             last_attempt_started_at = ?,
             last_request_id = ?,
             updated_at = ?
       WHERE site_id = ?
         AND device_id = ?
         AND attempts_used < ?
         AND (cooldown_until IS NULL OR cooldown_until <= ?)
    `).bind(
      maxAttempts,
      endsAt + cooldownMs,
      now,
      requestId,
      now,
      payment.site_id,
      payment.device_id,
      maxAttempts,
      now
    ),

    env.DB.prepare(`
      INSERT INTO access_attempts
        (id, site_id, device_id, payment_id, mac, attempt_number,
         starts_at, ends_at, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, attempts_used, ?, ?, 'active', ?, ?
        FROM attempt_limits
       WHERE site_id = ?
         AND device_id = ?
         AND last_request_id = ?
         AND NOT EXISTS (
           SELECT 1
             FROM access_attempts
            WHERE site_id = ?
              AND device_id = ?
              AND status = 'active'
              AND ends_at > ?
         )
    `).bind(
      attemptId,
      payment.site_id,
      payment.device_id,
      payment.id,
      normalizeMac(mac),
      now,
      endsAt,
      now,
      now,
      payment.site_id,
      payment.device_id,
      requestId,
      payment.site_id,
      payment.device_id,
      now
    ),
  ]);

  const created = await env.DB.prepare(`
    SELECT id
      FROM access_attempts
     WHERE id = ?
  `).bind(attemptId).first();

  const state = await getAttemptState(env, payment.site_id, payment.device_id, payment.id);

  if (created) {
    return { ok: true, reused: false, state };
  }

  if (state.inCooldown || state.attemptsRemaining <= 0) {
    return { ok: false, error: "attempt_cooldown", state };
  }

  // Em caso raro de concorrência, retorna o estado atual sem criar janela duplicada.
  if (state.activeUntil && state.activeUntil > now) {
    return { ok: true, reused: true, state };
  }

  return { ok: false, error: "attempt_not_started", state };
}

async function startPaymentAttempt(request, env, paymentId) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const deviceId = String(body.deviceId || "").trim();
  const mac = normalizeMac(body.mac);

  if (!deviceId || !validMac(mac)) {
    return json({ ok: false, error: "invalid_device" }, 400);
  }

  const payment = await env.DB.prepare(`
    SELECT *
      FROM payments
     WHERE id = ?
       AND device_id = ?
     LIMIT 1
  `).bind(paymentId, deviceId).first();

  if (!payment) {
    return json({ ok: false, error: "payment_not_found" }, 404);
  }

  const mapping = await env.DB.prepare(`
    SELECT device_id
      FROM device_macs
     WHERE site_id = ?
       AND mac = ?
  `).bind(payment.site_id, mac).first();

  if (!mapping || mapping.device_id !== deviceId) {
    return json({ ok: false, error: "device_mac_mismatch" }, 403);
  }

  const host = await validateCurrentRouterHost(env, payment.site_id, mac);
  if (!host) {
    return json({ ok: false, error: "device_not_seen_by_router" }, 403);
  }

  const result = await startAttemptWindow(env, payment, mac);

  return json({
    ok: result.ok,
    error: result.error || null,
    reused: !!result.reused,
    attempt: result.state,
    serverTime: Date.now(),
  }, result.ok ? 200 : (result.error === "attempt_cooldown" ? 429 : 409));
}

// ============================================================
// MERCADO PAGO / PIX
// ============================================================

async function persistOrderState(env, paymentRow, order) {
  const now = Date.now();
  const localStatus = mapOrderStatus(order);
  const tx = getOrderPayment(order);
  const paymentMethod = tx?.payment_method || {};
  const feeDetails=Array.isArray(tx?.fee_details)?tx.fee_details:[];
  const feeCents=feeDetails.length
    ?Math.max(0,Math.round(feeDetails.reduce((sum,f)=>sum+Number(f?.amount||0),0)*100))
    :null;

  await env.DB.prepare(`
    UPDATE payments
       SET mp_order_id = COALESCE(?, mp_order_id),
           mp_payment_id = COALESCE(?, mp_payment_id),
           mp_order_status = ?,
           mp_status_detail = ?,
           status = ?,
           qr_code = COALESCE(?, qr_code),
           qr_code_base64 = COALESCE(?, qr_code_base64),
           mp_last_checked_at = ?,
           fee_cents = COALESCE(?, fee_cents),
           updated_at = ?,
           approved_at = CASE
             WHEN ? = 'approved' AND approved_at IS NULL THEN ?
             ELSE approved_at
           END
     WHERE id = ?
  `).bind(
    order?.id || null, tx?.id || null, order?.status || null,
    order?.status_detail || null, localStatus,
    paymentMethod?.qr_code || null, paymentMethod?.qr_code_base64 || null,
    now, feeCents, now, localStatus, now, paymentRow.id
  ).run();

  if (localStatus === "approved") {
    const plan = await env.DB.prepare(`
      SELECT id,name,mode,duration_seconds,party_until_event_end,max_devices,
             rate_limit_down_kbps,rate_limit_up_kbps
        FROM plans WHERE id = ? AND site_id = ?
    `).bind(paymentRow.plan_id, paymentRow.site_id).first();

    if (!plan) throw new Error("plan_missing");

    let endsAt = null;
    if (Number(plan.party_until_event_end) === 1) {
      if (!paymentRow.event_id) throw new Error("party_event_missing");
      const event = await env.DB.prepare(`
        SELECT id, name, starts_at, ends_at FROM events
         WHERE id = ? AND site_id = ?
      `).bind(paymentRow.event_id, paymentRow.site_id).first();
      if (!event || Number(event.ends_at) <= now) throw new Error("party_event_ended");
      endsAt = Number(event.ends_at);
    } else {
      if (!Number(plan.duration_seconds)) throw new Error("plan_duration_missing");
      endsAt = now + Number(plan.duration_seconds) * 1000;
    }

    const statements = [
      env.DB.prepare(`
        UPDATE access_attempts SET status = 'converted', updated_at = ?
         WHERE payment_id = ? AND status = 'active'
      `).bind(now, paymentRow.id),
      env.DB.prepare(`
        INSERT INTO access_grants
          (id,site_id,device_id,payment_id,starts_at,ends_at,status,created_at,updated_at,
           grant_source,grant_label,rate_limit_down_kbps,rate_limit_up_kbps)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 'payment', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(
        `grant-${paymentRow.id}`,paymentRow.site_id,paymentRow.device_id,
        paymentRow.id,now,endsAt,now,now,
        plan.name||"Compra",Number(plan.rate_limit_down_kbps||0),Number(plan.rate_limit_up_kbps||0)
      )
    ];

    if (Number(plan.max_devices || 1) > 1) {
      const existingGroup = await env.DB.prepare(
        `SELECT id FROM party_groups WHERE payment_id = ?`
      ).bind(paymentRow.id).first();

      if (!existingGroup) {
        const groupId = uuid();
        const code = await ensureUniqueGroupCode(env, paymentRow.site_id);
        const publicToken = randomToken(24);

        statements.push(
          env.DB.prepare(`
            INSERT INTO party_groups (
              id, site_id, event_id, payment_id, owner_device_id,
              phone_e164, code, public_token, max_devices, expires_at,
              representative_name, representative_email, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
          `).bind(
            groupId, paymentRow.site_id, paymentRow.event_id, paymentRow.id,
            paymentRow.device_id, paymentRow.phone_e164 || "",
            code, publicToken, Number(plan.max_devices), endsAt,
            paymentRow.payer_email || null, now, now
          )
        );
        statements.push(
          env.DB.prepare(`
            INSERT INTO group_members (group_id, device_id, joined_at, is_owner)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(group_id, device_id) DO NOTHING
          `).bind(groupId, paymentRow.device_id, now)
        );
      }
    }

    await env.DB.batch(statements);
  }

  if (["refunded", "cancelled", "failed"].includes(localStatus)) {
    await env.DB.prepare(`
      UPDATE access_grants SET status = 'revoked', updated_at = ?
       WHERE payment_id = ? AND status = 'active'
    `).bind(now, paymentRow.id).run();
  }

  return localStatus;
}
async function syncOrderByPayment(env, paymentRow) {
  if (!paymentRow?.mp_order_id) return null;
  const order = await mpFetch(env, `/v1/orders/${encodeURIComponent(paymentRow.mp_order_id)}`, {
    method: "GET",
  });
  await persistOrderState(env, paymentRow, order);
  return order;
}

async function createMpOrder(env, paymentRow, plan, email) {
  const body = {
    type: "online",
    total_amount: money(plan.price_cents),
    external_reference: paymentRow.external_reference,
    processing_mode: "automatic",
    transactions: {
      payments: [
        {
          amount: money(plan.price_cents),
          payment_method: {
            id: "pix",
            type: "bank_transfer",
          },
          expiration_time: env.MP_PIX_EXPIRATION || "PT30M",
        },
      ],
    },
    payer: {
      email,
    },
  };

  const order = await mpFetch(env, "/v1/orders", {
    method: "POST",
    headers: {
      "X-Idempotency-Key": paymentRow.idempotency_key,
    },
    body: JSON.stringify(body),
  });

  await persistOrderState(env, paymentRow, order);
  return order;
}

async function getPaymentForResponse(env, id) {
  return env.DB.prepare(`
    SELECT p.id, p.site_id, p.device_id, p.plan_id, p.amount_cents,
           p.status, p.mp_order_id, p.mp_payment_id, p.mp_order_status,
           p.mp_status_detail, p.qr_code, p.qr_code_base64,
           p.mp_expires_at, p.attempt_window_until,
           p.created_at, p.approved_at, p.mp_last_checked_at,
           pl.name AS plan_name, pl.duration_seconds
      FROM payments p
      JOIN plans pl ON pl.id = p.plan_id
     WHERE p.id = ?
  `).bind(id).first();
}

function publicPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id,
    planName: row.plan_name,
    amountCents: row.amount_cents,
    status: row.status,
    mpStatus: row.mp_order_status,
    mpStatusDetail: row.mp_status_detail,
    qrCode: row.status === "pending" ? row.qr_code : null,
    qrCodeBase64: row.status === "pending" ? row.qr_code_base64 : null,
    pixExpiresAt: row.mp_expires_at,
    attemptWindowUntil: row.attempt_window_until,
    approvedAt: row.approved_at,
  };
}

async function createPayment(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const siteId = String(body.siteId || env.OPENWIFI_SITE_ID || "").trim();
  const deviceId = String(body.deviceId || "").trim();
  const planId = String(body.planId || "").trim();
  const mac = normalizeMac(body.mac);
  const email = safeLower(body.email).trim();
  const phone = normalizePhone(body.phone);

  if (!siteId || !deviceId || !planId || !validMac(mac) ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: "invalid_payment_data" }, 400);
  }

  const site = await env.DB.prepare(`
    SELECT mode, active_event_id, require_whatsapp_standard, sales_enabled
      FROM sites WHERE id = ?
  `).bind(siteId).first();

  if (!site) return json({ok:false,error:"site_not_found"},404);
  if (!site.sales_enabled) return json({ok:false,error:"sales_paused"},423);

  const requirePhone = site.mode === "party" || !!site.require_whatsapp_standard;
  if (requirePhone && phone.length < 12) {
    return json({ok:false,error:"whatsapp_required"},400);
  }

  const mapping = await env.DB.prepare(
    `SELECT device_id FROM device_macs WHERE site_id = ? AND mac = ?`
  ).bind(siteId, mac).first();
  if (!mapping || mapping.device_id !== deviceId) {
    return json({ok:false,error:"device_mac_mismatch"},403);
  }

  const host = await validateCurrentRouterHost(env, siteId, mac);
  if (!host) return json({ok:false,error:"device_not_seen_by_router"},403);

  if(!(await hasPrivacyAcceptance(env,siteId,deviceId))) {
    return json({ok:false,error:"privacy_acceptance_required"},428);
  }

  const allowedModes = site.mode === "party" ? ["party","both"] : ["standard","both"];
  const plan = await env.DB.prepare(`
    SELECT id,name,price_cents,duration_seconds,party_until_event_end,max_devices,mode
      FROM plans
     WHERE id=? AND site_id=? AND enabled=1 AND mode IN (?,?)
  `).bind(planId,siteId,allowedModes[0],allowedModes[1]).first();
  if (!plan) return json({ok:false,error:"plan_not_found"},404);

  let eventId = null;
  if (site.mode === "party") {
    if (!site.active_event_id) return json({ok:false,error:"party_event_required"},409);
    const event = await env.DB.prepare(`
      SELECT id,starts_at,ends_at FROM events WHERE id=? AND site_id=?
    `).bind(site.active_event_id,siteId).first();
    if (!event || Date.now() >= Number(event.ends_at)) {
      return json({ok:false,error:"party_event_ended"},409);
    }
    eventId = event.id;
  }

  const now = Date.now();
  await env.DB.prepare(`
    UPDATE devices
       SET payer_email=?, phone_e164=COALESCE(NULLIF(?,''),phone_e164), updated_at=?
     WHERE id=? AND site_id=?
  `).bind(email,phone,now,deviceId,siteId).run();

  let payment = await env.DB.prepare(`
    SELECT * FROM payments
     WHERE site_id=? AND device_id=? AND plan_id=? AND status='pending' AND mp_expires_at>?
     ORDER BY created_at DESC LIMIT 1
  `).bind(siteId,deviceId,planId,now).first();

  if (!payment) {
    const id=uuid(), externalReference=`ow_${id.replace(/-/g,"")}`, idempotencyKey=uuid();
    const mpExpiresAt=now+30*60*1000;
    const attemptWindowUntil=now+Number(env.ATTEMPT_WINDOW_MS||30000);
    await env.DB.prepare(`
      INSERT INTO payments (
        id,site_id,device_id,plan_id,event_id,mp_order_id,payer_email,phone_e164,
        amount_cents,fee_cents,status,created_at,approved_at,updated_at,
        external_reference,idempotency_key,mp_expires_at,attempt_window_until
      ) VALUES (?,?,?,?,?,NULL,?,?,?,NULL,'pending',?,NULL,?,?,?,?,?)
    `).bind(
      id,siteId,deviceId,planId,eventId,email,phone||null,plan.price_cents,
      now,now,externalReference,idempotencyKey,mpExpiresAt,attemptWindowUntil
    ).run();
    payment=await env.DB.prepare(`SELECT * FROM payments WHERE id=?`).bind(id).first();
  }

  try {
    if (!payment.mp_order_id || !payment.qr_code) await createMpOrder(env,payment,plan,email);
  } catch (err) {
    if (err?.status === 429) return json({ok:false,error:"mercadopago_rate_limited"},503);
    return json({ok:false,error:"mercadopago_create_failed",details:err?.data||String(err?.message||err)},502);
  }

  const saved=await getPaymentForResponse(env,payment.id);
  return json({ok:true,reused:!!payment.mp_order_id,payment:publicPayment(saved)});
}
async function paymentStatus(url, env, id) {
  let payment = await getPaymentForResponse(env, id);
  if (!payment) return json({ ok: false, error: "payment_not_found" }, 404);

  const now = Date.now();
  const fallbackMs = Number(env.MP_FALLBACK_SYNC_MS || 20000);
  const checkedAt = Number(payment.mp_last_checked_at || 0);

  // O webhook é o principal. Este GET ao MP é apenas redundância.
  if (
    payment.status === "pending" &&
    payment.mp_order_id &&
    (!checkedAt || now - checkedAt >= fallbackMs)
  ) {
    try {
      await syncOrderByPayment(env, payment);
      payment = await getPaymentForResponse(env, id);
    } catch {
      // Não derruba a página por falha temporária do MP.
    }
  }

  const grant = await env.DB.prepare(`
    SELECT starts_at, ends_at, status
      FROM access_grants
     WHERE payment_id = ?
     LIMIT 1
  `).bind(id).first();

  const attempt = await getAttemptState(
    env,
    payment.site_id,
    payment.device_id,
    payment.id
  );

  const group = await env.DB.prepare(`
    SELECT id,code,public_token,max_devices,expires_at
      FROM party_groups WHERE payment_id=? LIMIT 1
  `).bind(id).first();

  let groupPublic=null;
  if(group){
    const count=await env.DB.prepare(`SELECT COUNT(*) AS c FROM group_members WHERE group_id=?`).bind(group.id).first();
    groupPublic={
      code:group.code,
      maxDevices:Number(group.max_devices),
      usedDevices:Number(count?.c||0),
      expiresAt:Number(group.expires_at),
      publicUrl:`${env.OPENWIFI_BASE_URL||""}/group?token=${group.public_token}`
    };
  }

  return json({
    ok: true,
    payment: publicPayment(payment),
    access: grant || null,
    attempt,
    group: groupPublic,
    serverTime: Date.now(),
  });
}

// ============================================================
// WEBHOOK MERCADO PAGO
// ============================================================

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function secureEqualHex(a, b) {
  return secureTextEqual(
    String(a||"").toLowerCase(),
    String(b||"").toLowerCase()
  );
}

async function validateMpWebhook(request, url, env) {
  if (!env.MP_WEBHOOK_SECRET) return false;

  const xSignature = request.headers.get("x-signature") || "";
  const xRequestId = request.headers.get("x-request-id") || "";
  const dataIdRaw = url.searchParams.get("data.id") || "";

  let ts = "";
  let v1 = "";

  for (const part of xSignature.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }

  const dataId = dataIdRaw ? dataIdRaw.toLowerCase() : "";

  let manifest = "";
  if (dataId) manifest += `id:${dataId};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  if (ts) manifest += `ts:${ts};`;

  if (!manifest || !v1) return false;

  const computed = await hmacHex(env.MP_WEBHOOK_SECRET, manifest);
  return secureEqualHex(computed, v1);
}

async function syncWebhookOrder(env, orderId) {
  if (!orderId) return;

  const payment = await env.DB.prepare(`
    SELECT *
      FROM payments
     WHERE mp_order_id = ?
     LIMIT 1
  `).bind(orderId).first();

  // Ignora orders que não pertencem ao Open Wi-Fi.
  if (!payment) return;

  const order = await mpFetch(env, `/v1/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });

  await persistOrderState(env, payment, order);
}

async function mercadoPagoWebhook(request, url, env, ctx) {
  const valid = await validateMpWebhook(request, url, env);
  if (!valid) {
    return json({ ok: false, error: "invalid_webhook_signature" }, 401);
  }

  let body = null;
  try { body = await request.json(); }
  catch { body = null; }

  const orderId =
    url.searchParams.get("data.id") ||
    body?.data?.id ||
    "";

  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  ctx.waitUntil(
    env.DB.prepare(`
      UPDATE sites SET last_mp_webhook_at=?,last_mp_webhook_order_id=?,updated_at=?
       WHERE id=?
    `).bind(Date.now(),String(orderId||"")||null,Date.now(),siteId).run().catch(()=>{})
  );

  // MP pede resposta 200/201 rapidamente. O processamento segue no waitUntil.
  ctx.waitUntil(syncWebhookOrder(env, orderId).catch((err) => {
    console.error(JSON.stringify({
      message:"mercadopago webhook sync failed",
      orderId:String(orderId||"")||null,
      error:err instanceof Error?err.message:String(err)
    }));
  }));

  return json({ ok: true }, 200);
}


// ============================================================
// CÓDIGOS / GRUPOS
// ============================================================

async function redeemAccessCode(request, env) {
  let b;
  try { b = await request.json(); }
  catch { return json({ok:false,error:"invalid_json"},400); }

  const siteId=String(b.siteId||env.OPENWIFI_SITE_ID||"");
  const deviceId=String(b.deviceId||"");
  const mac=normalizeMac(b.mac);
  const code=String(b.code||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");

  if(!deviceId||!validMac(mac)||code.length<6) {
    return json({ok:false,error:"invalid_code_data"},400);
  }

  const mapping=await env.DB.prepare(
    `SELECT device_id FROM device_macs WHERE site_id=? AND mac=?`
  ).bind(siteId,mac).first();

  if(!mapping||mapping.device_id!==deviceId) {
    return json({ok:false,error:"device_mac_mismatch"},403);
  }

  if(!(await validateCurrentRouterHost(env,siteId,mac))) {
    return json({ok:false,error:"device_not_seen_by_router"},403);
  }

  if(!(await hasPrivacyAcceptance(env,siteId,deviceId))) {
    return json({ok:false,error:"privacy_acceptance_required"},428);
  }

  const now=Date.now();
  const row=await env.DB.prepare(`
    SELECT * FROM access_codes
     WHERE site_id=? AND code=?
     LIMIT 1
  `).bind(siteId,code).first();

  if(!row) return json({ok:false,error:"access_code_not_found"},404);

  if(row.status==="consumed"&&row.redeemed_device_id===deviceId) {
    const grant=await env.DB.prepare(`
      SELECT starts_at,ends_at,status
        FROM access_grants
       WHERE id=?
    `).bind(`code-${row.id}`).first();

    if(grant?.status==="active" && Number(grant.ends_at)>now) {
      return json({
        ok:true,
        reused:true,
        permanent:!!row.is_permanent,
        access:grant
      });
    }

    return json({
      ok:false,
      error:"access_code_already_consumed"
    },410);
  }

  if(row.status!=="active"||Number(row.uses)>=Number(row.max_uses)) {
    return json({ok:false,error:"access_code_unavailable"},410);
  }

  // Códigos antigos que possuíam expiração real continuam respeitando-a.
  // Os novos códigos usam expires_at distante e duration_seconds como tempo de acesso.
  if(Number(row.expires_at)<=now) {
    return json({ok:false,error:"access_code_expired"},410);
  }

  const PERMANENT_UNTIL=253402300799000; // 9999-12-31T23:59:59Z
  let endsAt;

  if(Number(row.is_permanent)===1) {
    endsAt=PERMANENT_UNTIL;
  } else if(Number(row.duration_seconds)>0) {
    endsAt=now+Number(row.duration_seconds)*1000;
  } else if(row.event_id) {
    // Compatibilidade com códigos Party criados por versões anteriores.
    const ev=await env.DB.prepare(`
      SELECT ends_at FROM events WHERE id=? AND site_id=?
    `).bind(row.event_id,siteId).first();

    if(!ev||Number(ev.ends_at)<=now) {
      return json({ok:false,error:"party_event_ended"},410);
    }
    endsAt=Number(ev.ends_at);
  } else {
    endsAt=now+86400000;
  }

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE access_codes
         SET uses=uses+1,
             status=CASE WHEN uses+1>=max_uses THEN 'consumed' ELSE status END,
             redeemed_device_id=?,
             redeemed_at=?,
             updated_at=?
       WHERE id=? AND status='active' AND uses<max_uses
    `).bind(deviceId,now,now,row.id),

    env.DB.prepare(`
      INSERT INTO access_grants(
        id,site_id,device_id,payment_id,starts_at,ends_at,status,created_at,updated_at,
        grant_source,grant_label,rate_limit_down_kbps,rate_limit_up_kbps
      )
      VALUES(?,?,?,NULL,?,?,'active',?,?, 'code',?,0,0)
      ON CONFLICT(id) DO NOTHING
    `).bind(`code-${row.id}`,siteId,deviceId,now,endsAt,now,now,`Código ${row.code}`)
  ]);

  return json({
    ok:true,
    permanent:Number(row.is_permanent)===1,
    access:{starts_at:now,ends_at:endsAt,status:"active"}
  });
}
async function joinPartyGroup(request, env) {
  let b;try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const siteId=String(b.siteId||env.OPENWIFI_SITE_ID||""),deviceId=String(b.deviceId||"");
  const mac=normalizeMac(b.mac),code=String(b.code||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(!deviceId||!validMac(mac)||code.length<6)return json({ok:false,error:"invalid_group_data"},400);

  const mapping=await env.DB.prepare(`
    SELECT device_id FROM device_macs WHERE site_id=? AND mac=?
  `).bind(siteId,mac).first();
  if(!mapping||mapping.device_id!==deviceId)return json({ok:false,error:"device_mac_mismatch"},403);

  if(!(await hasPrivacyAcceptance(env,siteId,deviceId))) {
    return json({ok:false,error:"privacy_acceptance_required"},428);
  }

  const now=Date.now();
  const group=await env.DB.prepare(`
    SELECT pg.*,pl.name AS plan_name,
           COALESCE(pl.rate_limit_down_kbps,0) AS rate_limit_down_kbps,
           COALESCE(pl.rate_limit_up_kbps,0) AS rate_limit_up_kbps
      FROM party_groups pg
      LEFT JOIN payments p ON p.id=pg.payment_id
      LEFT JOIN plans pl ON pl.id=p.plan_id
     WHERE pg.site_id=? AND pg.code=? AND pg.expires_at>?
     LIMIT 1
  `).bind(siteId,code,now).first();

  if(!group)return json({ok:false,error:"group_not_found_or_expired"},404);

  const already=await env.DB.prepare(`
    SELECT 1 AS ok FROM group_members WHERE group_id=? AND device_id=?
  `).bind(group.id,deviceId).first();

  if(!already){
    const another=await env.DB.prepare(`
      SELECT pg.id
        FROM group_members gm JOIN party_groups pg ON pg.id=gm.group_id
       WHERE gm.device_id=? AND pg.site_id=? AND pg.expires_at>? AND pg.id<>?
       LIMIT 1
    `).bind(deviceId,siteId,now,group.id).first();
    if(another)return json({ok:false,error:"device_in_another_group"},409);

    const count=await env.DB.prepare(`
      SELECT COUNT(*) AS c FROM group_members WHERE group_id=?
    `).bind(group.id).first();
    if(Number(count?.c||0)>=Number(group.max_devices))return json({ok:false,error:"group_full"},409);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO group_members(group_id,device_id,joined_at,is_owner)
        VALUES(?,?,?,0)
      `).bind(group.id,deviceId,now),

      env.DB.prepare(`
        INSERT INTO access_grants(
          id,site_id,device_id,payment_id,starts_at,ends_at,status,created_at,updated_at,
          grant_source,grant_label,rate_limit_down_kbps,rate_limit_up_kbps
        )
        VALUES(?,?,?,NULL,?,?,'active',?,?, 'group',?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          ends_at=excluded.ends_at,status='active',updated_at=excluded.updated_at,
          rate_limit_down_kbps=excluded.rate_limit_down_kbps,
          rate_limit_up_kbps=excluded.rate_limit_up_kbps
      `).bind(
        `group-${group.id}-${deviceId}`,siteId,deviceId,now,Number(group.expires_at),
        now,now,group.plan_name||`Grupo ${group.code}`,
        Number(group.rate_limit_down_kbps||0),Number(group.rate_limit_up_kbps||0)
      )
    ]);
  }

  const c=await env.DB.prepare(`
    SELECT COUNT(*) AS c FROM group_members WHERE group_id=?
  `).bind(group.id).first();

  return json({ok:true,group:{
    code:group.code,usedDevices:Number(c?.c||0),maxDevices:Number(group.max_devices),
    expiresAt:Number(group.expires_at),publicUrl:`${env.OPENWIFI_BASE_URL||""}/group?token=${group.public_token}`
  }});
}
async function publicGroupData(url, env) {
  const token=String(url.searchParams.get("token")||"");
  if(!token)return json({ok:false,error:"token_required"},400);
  const g=await env.DB.prepare(`
    SELECT pg.id,pg.code,pg.max_devices,pg.expires_at,e.name AS event_name
      FROM party_groups pg LEFT JOIN events e ON e.id=pg.event_id
     WHERE pg.public_token=? LIMIT 1
  `).bind(token).first();
  if(!g)return json({ok:false,error:"group_not_found"},404);
  const members=await env.DB.prepare(`SELECT joined_at,is_owner FROM group_members WHERE group_id=? ORDER BY is_owner DESC,joined_at`).bind(g.id).all();
  return json({ok:true,group:{
    code:g.code,eventName:g.event_name||"Evento Open Wi-Fi",maxDevices:Number(g.max_devices),
    usedDevices:members.results.length,expiresAt:Number(g.expires_at),
    members:members.results.map((m,i)=>({label:`Dispositivo ${i+1}`,owner:!!m.is_owner,joinedAt:Number(m.joined_at)}))
  }});
}

function groupPage(){
return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grupo • Open Wi-Fi</title>
<link rel="icon" href="/assets/site-logo?site=openwifi-main">
<style>
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 90% 0,rgba(139,124,246,.18),transparent 35%),#090d18;color:#f4f7ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
.w{max-width:520px;margin:auto;padding:24px 14px}.c{background:#111827;border:1px solid #293754;border-radius:18px;padding:17px;margin-bottom:11px}
.big{font-size:33px;font-weight:950;color:#a8c9ff}.muted{color:#98a6c1;font-size:12px}.slot{border-top:1px solid #293754;padding:11px 0}
.badge{font-size:10px;border:1px solid #354664;border-radius:99px;padding:3px 7px;color:#b7ccff}
</style></head><body><div class="w">
<div class="c"><h2 id="ev" style="margin-top:0">Open Wi-Fi</h2><div class="muted">Acompanhamento do representante • somente leitura</div><div class="big" id="count">—</div><div id="exp" class="muted"></div></div>
<div class="c"><div class="muted">Código do grupo</div><div class="big" id="code">—</div></div>
<div class="c" id="members"><b>Dispositivos</b></div>
</div><script>
const token=new URLSearchParams(location.search).get("token")||"";
async function load(){
  const r=await fetch("/api/group/public?token="+encodeURIComponent(token));
  const d=await r.json();
  if(!d.ok)return;
  const g=d.group;
  document.getElementById("ev").textContent=g.eventName;
  document.getElementById("count").textContent=g.usedDevices+" / "+g.maxDevices;
  document.getElementById("code").textContent=g.code;
  document.getElementById("exp").textContent="Válido até "+new Date(g.expiresAt).toLocaleString("pt-BR");
  document.getElementById("members").innerHTML="<b>Dispositivos</b>"+g.members.map(m=>"<div class='slot'>"+m.label+(m.owner?" <span class='badge'>representante</span>":"")+"</div>").join("");
}
load();setInterval(load,10000);
</script></body></html>`;
}

async function hasPrivacyAcceptance(env,siteId,deviceId) {
  const site=await env.DB.prepare(`
    SELECT privacy_require_accept,privacy_policy_version
      FROM sites WHERE id=?
  `).bind(siteId).first();

  if(!site?.privacy_require_accept)return true;

  const row=await env.DB.prepare(`
    SELECT 1 AS ok
      FROM privacy_acceptances
     WHERE site_id=? AND device_id=? AND policy_version=?
  `).bind(siteId,deviceId,Number(site.privacy_policy_version||1)).first();

  return !!row;
}

async function acceptPrivacy(request,env) {
  let b;
  try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}

  const siteId=String(b.siteId||env.OPENWIFI_SITE_ID||"");
  const deviceId=String(b.deviceId||"");
  if(!siteId||!deviceId)return json({ok:false,error:"invalid_privacy_data"},400);

  const site=await env.DB.prepare(`
    SELECT privacy_policy_version FROM sites WHERE id=?
  `).bind(siteId).first();
  if(!site)return json({ok:false,error:"site_not_found"},404);

  const exists=await env.DB.prepare(`
    SELECT 1 AS ok FROM devices WHERE id=? AND site_id=?
  `).bind(deviceId,siteId).first();
  if(!exists)return json({ok:false,error:"device_not_found"},404);

  const now=Date.now();
  await env.DB.prepare(`
    INSERT INTO privacy_acceptances(site_id,device_id,policy_version,accepted_at)
    VALUES(?,?,?,?)
    ON CONFLICT(site_id,device_id,policy_version)
    DO UPDATE SET accepted_at=excluded.accepted_at
  `).bind(siteId,deviceId,Number(site.privacy_policy_version||1),now).run();

  return json({ok:true,acceptedAt:now,policyVersion:Number(site.privacy_policy_version||1)});
}

async function adminUploadMedia(request,env,kind) {
  if(!["logo","background"].includes(kind))return json({ok:false,error:"invalid_media_kind"},400);
  if(!env.MEDIA)return json({ok:false,error:"r2_not_configured"},503);

  let form;
  try{form=await request.formData()}catch{return json({ok:false,error:"invalid_form_data"},400)}

  const file=form.get("file");
  if(!file||typeof file.arrayBuffer!=="function")return json({ok:false,error:"file_required"},400);

  const type=String(file.type||"").toLowerCase();
  const allowed=["image/png","image/jpeg","image/webp","image/svg+xml","image/avif"];
  if(!allowed.includes(type))return json({ok:false,error:"unsupported_image_type"},415);
  if(Number(file.size||0)>5*1024*1024)return json({ok:false,error:"image_too_large"},413);

  const ext={
    "image/png":"png","image/jpeg":"jpg","image/webp":"webp",
    "image/svg+xml":"svg","image/avif":"avif"
  }[type]||"bin";

  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const key=`sites/${siteId}/${kind}/${Date.now()}-${uuid()}.${ext}`;
  await env.MEDIA.put(key,file.stream(),{
    httpMetadata:{contentType:type,cacheControl:"public, max-age=300"},
    customMetadata:{siteId,kind}
  });

  const column=kind==="logo"?"logo_image_url":"background_image_url";
  const previous=await env.DB.prepare(`SELECT ${column} AS v FROM sites WHERE id=?`).bind(siteId).first();

  await env.DB.prepare(`
    UPDATE sites SET ${column}=?,background_mode=CASE WHEN ?='background' THEN 'image' ELSE background_mode END,updated_at=?
     WHERE id=?
  `).bind(`r2://${key}`,kind,Date.now(),siteId).run();

  const old=String(previous?.v||"");
  if(old.startsWith("r2://")){
    try{await env.MEDIA.delete(old.slice(5))}catch{}
  }

  await audit(env,siteId,"media.upload",{kind,key,size:Number(file.size||0),type});

  return json({
    ok:true,
    kind,
    url:`/assets/site-${kind==="logo"?"logo":"background"}?site=${encodeURIComponent(siteId)}&v=${Date.now()}`
  });
}

async function adminDeleteMedia(env,kind) {
  if(!["logo","background"].includes(kind))return json({ok:false,error:"invalid_media_kind"},400);
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const column=kind==="logo"?"logo_image_url":"background_image_url";
  const row=await env.DB.prepare(`SELECT ${column} AS v FROM sites WHERE id=?`).bind(siteId).first();
  const old=String(row?.v||"");

  await env.DB.prepare(`
    UPDATE sites
       SET ${column}=NULL,
           background_mode=CASE WHEN ?='background' THEN 'gradient' ELSE background_mode END,
           updated_at=?
     WHERE id=?
  `).bind(kind,Date.now(),siteId).run();

  if(old.startsWith("r2://")&&env.MEDIA){
    try{await env.MEDIA.delete(old.slice(5))}catch{}
  }

  await audit(env,siteId,"media.delete",{kind});
  return json({ok:true});
}

async function adminUserDetail(env,id) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const user=await env.DB.prepare(`
    SELECT id,hostname,payer_email,phone_e164,created_at,updated_at
      FROM devices WHERE id=? AND site_id=?
  `).bind(id,siteId).first();
  if(!user)return json({ok:false,error:"user_not_found"},404);

  const [macs,payments,grants,attempts,groups]=await Promise.all([
    env.DB.prepare(`
      SELECT dm.mac,rh.ip,rh.hostname,rh.last_seen_at
        FROM device_macs dm
        LEFT JOIN router_hosts rh ON rh.site_id=dm.site_id AND rh.mac=dm.mac
       WHERE dm.site_id=? AND dm.device_id=?
       ORDER BY rh.last_seen_at DESC
    `).bind(siteId,id).all(),
    env.DB.prepare(`
      SELECT p.id,p.status,p.amount_cents,p.fee_cents,p.created_at,p.approved_at,p.mp_order_id,
             pl.name AS plan_name
        FROM payments p
        JOIN plans pl ON pl.id=p.plan_id
       WHERE p.site_id=? AND p.device_id=?
       ORDER BY p.created_at DESC LIMIT 50
    `).bind(siteId,id).all(),
    env.DB.prepare(`
      SELECT id,payment_id,starts_at,ends_at,status,grant_source,grant_label,
             rate_limit_down_kbps,rate_limit_up_kbps,created_at
        FROM access_grants
       WHERE site_id=? AND device_id=?
       ORDER BY created_at DESC LIMIT 50
    `).bind(siteId,id).all(),
    env.DB.prepare(`
      SELECT attempt_number,mac,starts_at,ends_at,router_started_at,status,created_at
        FROM access_attempts
       WHERE site_id=? AND device_id=?
       ORDER BY created_at DESC LIMIT 30
    `).bind(siteId,id).all(),
    env.DB.prepare(`
      SELECT pg.code,pg.max_devices,pg.expires_at,e.name AS event_name,gm.is_owner,gm.joined_at
        FROM group_members gm
        JOIN party_groups pg ON pg.id=gm.group_id
        LEFT JOIN events e ON e.id=pg.event_id
       WHERE gm.device_id=? AND pg.site_id=?
       ORDER BY gm.joined_at DESC LIMIT 20
    `).bind(id,siteId).all()
  ]);

  return json({
    ok:true,user,macs:macs.results,payments:payments.results,
    grants:grants.results,attempts:attempts.results,groups:groups.results
  });
}

async function adminCourtesy(request,env,id) {
  let b;
  try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}

  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const exists=await env.DB.prepare(`SELECT 1 AS ok FROM devices WHERE id=? AND site_id=?`).bind(id,siteId).first();
  if(!exists)return json({ok:false,error:"user_not_found"},404);

  const type=["minutes","event","permanent"].includes(b.type)?b.type:"minutes";
  const now=Date.now();
  let endsAt;

  if(type==="permanent"){
    endsAt=253402300799000;
  }else if(type==="event"){
    const site=await env.DB.prepare(`SELECT active_event_id FROM sites WHERE id=?`).bind(siteId).first();
    if(!site?.active_event_id)return json({ok:false,error:"active_event_required"},409);
    const event=await env.DB.prepare(`SELECT ends_at FROM events WHERE id=? AND site_id=?`).bind(site.active_event_id,siteId).first();
    if(!event||Number(event.ends_at)<=now)return json({ok:false,error:"event_ended"},409);
    endsAt=Number(event.ends_at);
  }else{
    const minutes=Math.max(1,Math.min(5256000,Math.round(Number(b.minutes||60))));
    endsAt=now+minutes*60000;
  }

  const down=Math.max(0,Math.round(Number(b.downKbps||0)));
  const up=Math.max(0,Math.round(Number(b.upKbps||0)));
  const grantId=`courtesy-${uuid()}`;
  const label=String(b.label||"Cortesia administrativa").slice(0,120);

  await env.DB.prepare(`
    INSERT INTO access_grants(
      id,site_id,device_id,payment_id,starts_at,ends_at,status,created_at,updated_at,
      grant_source,grant_label,rate_limit_down_kbps,rate_limit_up_kbps
    )
    VALUES(?,?,?,NULL,?,?,'active',?,?, 'courtesy',?,?,?)
  `).bind(grantId,siteId,id,now,endsAt,now,now,label,down,up).run();

  await audit(env,siteId,"users.courtesy",{deviceId:id,type,endsAt,down,up,label});
  return json({ok:true,id:grantId,startsAt:now,endsAt,permanent:type==="permanent"});
}

async function adminEmergency(request,env) {
  let b;
  try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const salesEnabled=!!b.salesEnabled;
  const message=String(b.message||"Novas vendas estão temporariamente pausadas. Acessos já liberados continuam funcionando.").slice(0,300);

  await env.DB.prepare(`
    UPDATE sites SET sales_enabled=?,emergency_message=?,updated_at=? WHERE id=?
  `).bind(salesEnabled?1:0,message,Date.now(),siteId).run();

  await audit(env,siteId,salesEnabled?"sales.resume":"sales.pause",{message});
  return json({ok:true,salesEnabled,message});
}

async function adminDiagnostics(env) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const now=Date.now();
  const site=await env.DB.prepare(`SELECT * FROM sites WHERE id=?`).bind(siteId).first();

  let d1={ok:false};
  try{
    const t0=Date.now();
    const row=await env.DB.prepare(`SELECT 1 AS ok`).first();
    d1={ok:row?.ok===1,latencyMs:Date.now()-t0};
  }catch(e){d1={ok:false,error:String(e?.message||e)}}

  let mp={ok:false,configured:!!env.MP_ACCESS_TOKEN};
  if(env.MP_ACCESS_TOKEN){
    try{
      const t0=Date.now();
      await mpFetch(env,"/v1/payment_methods",{method:"GET"});
      mp={ok:true,configured:true,latencyMs:Date.now()-t0};
    }catch(e){
      mp={ok:false,configured:true,error:String(e?.message||e)};
    }
  }

  const latestPayment=await env.DB.prepare(`
    SELECT id,status,mp_order_id,created_at,approved_at,mp_last_checked_at
      FROM payments WHERE site_id=? ORDER BY created_at DESC LIMIT 1
  `).bind(siteId).first();

  const pending=await env.DB.prepare(`
    SELECT COUNT(*) AS c FROM payments WHERE site_id=? AND status='pending'
  `).bind(siteId).first();

  return json({
    ok:true,
    serverTime:now,
    router:{
      ok:!!site?.router_last_seen_at&&now-Number(site.router_last_seen_at)<=Number(env.ROUTER_OFFLINE_AFTER_MS||90000),
      lastSeenAt:site?.router_last_seen_at||null,
      identity:site?.router_identity||null,
      board:site?.router_board||null,
      version:site?.router_version||null,
      hosts:Number(site?.router_host_count||0)
    },
    d1,
    mercadoPago:mp,
    webhook:{
      configured:!!env.MP_WEBHOOK_SECRET,
      lastSeenAt:site?.last_mp_webhook_at||null,
      lastOrderId:site?.last_mp_webhook_order_id||null
    },
    media:{ok:!!env.MEDIA,configured:!!env.MEDIA},
    latestPayment:latestPayment||null,
    pendingPayments:Number(pending?.c||0),
    lastReconcileAt:site?.last_reconcile_at||null
  });
}

function reportPeriodFromEvent(event) {
  if(event)return {start:Number(event.starts_at),end:Number(event.ends_at),name:event.name,eventId:event.id};
  const {start,end}=saoPauloDayBounds(Date.now());
  return {start,end,name:"Hoje",eventId:null};
}

async function resolveReportEvent(url,env) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const requested=String(url.searchParams.get("eventId")||"");
  if(requested){
    return env.DB.prepare(`SELECT * FROM events WHERE id=? AND site_id=?`).bind(requested,siteId).first();
  }
  const site=await env.DB.prepare(`SELECT active_event_id FROM sites WHERE id=?`).bind(siteId).first();
  if(site?.active_event_id){
    const active=await env.DB.prepare(`SELECT * FROM events WHERE id=? AND site_id=?`).bind(site.active_event_id,siteId).first();
    if(active)return active;
  }
  return null;
}

async function adminEvents(env) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const rows=await env.DB.prepare(`
    SELECT id,name,starts_at,ends_at,status,created_at
      FROM events
     WHERE site_id=?
     ORDER BY starts_at DESC
     LIMIT 100
  `).bind(siteId).all();
  return json({ok:true,events:rows.results});
}

async function adminReport(url,env) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const event=await resolveReportEvent(url,env);
  const period=reportPeriodFromEvent(event);

  const [payments,visitors,plans,groups]=await Promise.all([
    env.DB.prepare(`
      SELECT p.id,p.device_id,p.amount_cents,COALESCE(p.fee_cents,0) AS fee_cents,
             p.approved_at,p.payer_email,p.phone_e164,pl.id AS plan_id,pl.name AS plan_name
        FROM payments p JOIN plans pl ON pl.id=p.plan_id
       WHERE p.site_id=? AND p.status='approved' AND p.approved_at>=? AND p.approved_at<?
       ORDER BY p.approved_at
    `).bind(siteId,period.start,period.end).all(),
    env.DB.prepare(`
      SELECT COUNT(DISTINCT device_id) AS c
        FROM portal_visits
       WHERE site_id=? AND visited_at>=? AND visited_at<?
    `).bind(siteId,period.start,period.end).first(),
    env.DB.prepare(`
      SELECT pl.id,pl.name,COUNT(p.id) AS sales,COALESCE(SUM(p.amount_cents),0) AS revenue_cents
        FROM plans pl LEFT JOIN payments p
          ON p.plan_id=pl.id AND p.status='approved' AND p.approved_at>=? AND p.approved_at<?
       WHERE pl.site_id=?
       GROUP BY pl.id ORDER BY revenue_cents DESC
    `).bind(period.start,period.end,siteId).all(),
    env.DB.prepare(`
      SELECT pg.id,pg.max_devices,COUNT(gm.device_id) AS used_devices
        FROM party_groups pg LEFT JOIN group_members gm ON gm.group_id=pg.id
       WHERE pg.site_id=? AND pg.created_at>=? AND pg.created_at<?
       GROUP BY pg.id
    `).bind(siteId,period.start,period.end).all()
  ]);

  const rows=payments.results;
  const gross=rows.reduce((a,r)=>a+Number(r.amount_cents||0),0);
  const fees=rows.reduce((a,r)=>a+Number(r.fee_cents||0),0);
  const buyers=new Set(rows.map(r=>r.device_id)).size;
  const hourly={};

  for(const r of rows){
    const d=new Date(Number(r.approved_at)-3*3600000);
    const h=String(d.getUTCHours()).padStart(2,"0")+":00";
    hourly[h]??={sales:0,revenueCents:0};
    hourly[h].sales++;
    hourly[h].revenueCents+=Number(r.amount_cents||0);
  }

  const groupCount=groups.results.length;
  const groupSlots=groups.results.reduce((a,g)=>a+Number(g.max_devices||0),0);
  const groupUsed=groups.results.reduce((a,g)=>a+Number(g.used_devices||0),0);
  const visitorCount=Number(visitors?.c||0);

  return json({
    ok:true,
    event:event||null,
    period,
    summary:{
      sales:rows.length,
      buyers,
      visitors:visitorCount,
      conversionPct:visitorCount?Math.round((buyers/visitorCount)*10000)/100:0,
      grossCents:gross,
      feesCents:fees,
      netCents:gross-fees,
      groups:groupCount,
      groupSlots,
      groupUsed,
      groupOccupancyPct:groupSlots?Math.round((groupUsed/groupSlots)*10000)/100:0
    },
    hourly:Object.entries(hourly).map(([hour,v])=>({hour,...v})),
    plans:plans.results
  });
}

async function adminReportCsv(url,env) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const event=await resolveReportEvent(url,env);
  const period=reportPeriodFromEvent(event);
  const rows=await env.DB.prepare(`
    SELECT p.id,p.status,p.amount_cents,COALESCE(p.fee_cents,0) AS fee_cents,
           p.payer_email,p.phone_e164,p.created_at,p.approved_at,p.mp_order_id,
           pl.name AS plan_name
      FROM payments p JOIN plans pl ON pl.id=p.plan_id
     WHERE p.site_id=? AND p.created_at>=? AND p.created_at<?
     ORDER BY p.created_at
  `).bind(siteId,period.start,period.end).all();

  const quote=v=>`"${String(v??"").replace(/"/g,'""')}"`;
  const lines=[["id","status","plano","valor_centavos","taxa_centavos","email","whatsapp","criado_em","aprovado_em","mp_order_id"].map(quote).join(",")];

  for(const r of rows.results){
    lines.push([
      r.id,r.status,r.plan_name,r.amount_cents,r.fee_cents,r.payer_email,r.phone_e164,
      r.created_at,r.approved_at,r.mp_order_id
    ].map(quote).join(","));
  }

  return new Response("\ufeff"+lines.join("\r\n"),{
    headers:{
      "content-type":"text/csv; charset=utf-8",
      "content-disposition":`attachment; filename="openwifi-${String(event?.name||"hoje").replace(/[^a-zA-Z0-9_-]+/g,"-")}.csv"`
    }
  });
}

async function adminAnalytics(env) {
  const url=new URL("https://local/");
  const reportResponse=await adminReport(url,env);
  const data=await reportResponse.json();
  return json(data);
}

async function adminReconcile(env) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const rows=await env.DB.prepare(`
    SELECT * FROM payments
     WHERE site_id=? AND mp_order_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 20
  `).bind(siteId).all();

  const results=[];
  for(const payment of rows.results){
    try{
      const order=await mpFetch(env,`/v1/orders/${encodeURIComponent(payment.mp_order_id)}`,{method:"GET"});
      const remote=mapOrderStatus(order);
      const before=payment.status;
      await persistOrderState(env,payment,order);
      results.push({id:payment.id,orderId:payment.mp_order_id,before,remote,changed:before!==remote});
    }catch(e){
      results.push({id:payment.id,orderId:payment.mp_order_id,error:String(e?.message||e)});
    }
  }

  await env.DB.prepare(`UPDATE sites SET last_reconcile_at=?,updated_at=? WHERE id=?`)
    .bind(Date.now(),Date.now(),siteId).run();

  await audit(env,siteId,"payments.reconcile",{checked:results.length,changed:results.filter(r=>r.changed).length});
  return json({ok:true,checked:results.length,changed:results.filter(r=>r.changed).length,results});
}

async function adminAccounts(env) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const rows=await env.DB.prepare(`
    SELECT id,username,display_name,role,enabled,last_login_at,created_at,updated_at
      FROM admin_accounts WHERE site_id=? ORDER BY created_at
  `).bind(siteId).all();

  return json({
    ok:true,
    accounts:[
      {id:"env-owner",username:env.ADMIN_USER||"admin",display_name:"Administrador principal",role:"owner",enabled:1,source:"env"},
      ...rows.results.map(r=>({...r,source:"d1"}))
    ]
  });
}

async function adminAccountSave(request,env,id=null) {
  let b;
  try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const username=String(b.username||"").trim().toLowerCase().replace(/[^a-z0-9._-]/g,"");
  const displayName=String(b.displayName||username).trim().slice(0,80);
  const role=["admin","operator","viewer"].includes(b.role)?b.role:"viewer";
  const enabled=b.enabled===false?0:1;
  if(!username||username===(env.ADMIN_USER||"admin").toLowerCase())return json({ok:false,error:"invalid_username"},400);

  const now=Date.now();

  if(id){
    const row=await env.DB.prepare(`SELECT * FROM admin_accounts WHERE id=? AND site_id=?`).bind(id,siteId).first();
    if(!row)return json({ok:false,error:"account_not_found"},404);

    let salt=row.password_salt,hash=row.password_hash,iterations=row.password_iterations;
    if(String(b.password||"")){
      const rec=await makePasswordRecord(String(b.password));
      salt=rec.salt;hash=rec.hash;iterations=rec.iterations;
    }

    await env.DB.prepare(`
      UPDATE admin_accounts
         SET username=?,display_name=?,role=?,enabled=?,password_salt=?,password_hash=?,
             password_iterations=?,updated_at=?
       WHERE id=? AND site_id=?
    `).bind(username,displayName,role,enabled,salt,hash,iterations,now,id,siteId).run();

    await audit(env,siteId,"team.update",{id,username,role,enabled});
    return json({ok:true,id});
  }

  const password=String(b.password||"");
  const rec=await makePasswordRecord(password);
  const accountId=uuid();

  try{
    await env.DB.prepare(`
      INSERT INTO admin_accounts(
        id,site_id,username,display_name,role,password_salt,password_hash,
        password_iterations,enabled,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      accountId,siteId,username,displayName,role,rec.salt,rec.hash,rec.iterations,
      enabled,now,now
    ).run();
  }catch{
    return json({ok:false,error:"username_already_exists"},409);
  }

  await audit(env,siteId,"team.create",{id:accountId,username,role});
  return json({ok:true,id:accountId});
}

async function adminAccountDelete(env,id) {
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  await env.DB.prepare(`DELETE FROM admin_accounts WHERE id=? AND site_id=?`).bind(id,siteId).run();
  await audit(env,siteId,"team.delete",{id});
  return json({ok:true});
}

// ============================================================
// ADMIN
// ============================================================

async function adminLogin(request,env){
  let b;
  try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}

  const user=String(b.user||"").trim().toLowerCase();
  const password=String(b.password||"");
  const owner=(env.ADMIN_USER||"admin").toLowerCase();

  let identity=null;

  if(env.ADMIN_PASSWORD && user===owner && await secureTextEqual(password,env.ADMIN_PASSWORD)){
    identity={username:owner,displayName:"Administrador principal",role:"owner",source:"env"};
  }else{
    const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
    const row=await env.DB.prepare(`
      SELECT * FROM admin_accounts
       WHERE site_id=? AND username=? AND enabled=1
       LIMIT 1
    `).bind(siteId,user).first();

    if(row && await verifyPasswordRecord(password,row)){
      identity={
        username:row.username,
        displayName:row.display_name,
        role:row.role,
        source:"d1"
      };
      await env.DB.prepare(`UPDATE admin_accounts SET last_login_at=?,updated_at=? WHERE id=?`)
        .bind(Date.now(),Date.now(),row.id).run();
    }
  }

  if(!identity)return json({ok:false,error:"invalid_credentials"},401);

  const session=await createAdminSession(env,identity);
  const hours=Number(env.ADMIN_SESSION_HOURS||12);

  return json({
    ok:true,
    user:{username:identity.username,displayName:identity.displayName,role:identity.role}
  },200,{
    "set-cookie":`ow_admin=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(hours*3600)}`
  });
}

async function adminMe(request,env) {
  const session=await readAdminSession(request,env);
  if(!session)return json({ok:false,error:"unauthorized"},401);
  return json({
    ok:true,
    user:{
      username:session.sub,
      displayName:session.displayName||session.sub,
      role:session.role,
      source:session.source
    }
  });
}async function adminLogout(){
  return json({ok:true},200,{"set-cookie":"ow_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
}

async function adminPlatform(env){
  // Administrative accounts belong to the configured site. Cross-site reads
  // remain disabled until server-side memberships and authorization exist.
  const siteId=env.OPENWIFI_SITE_ID||'openwifi-main';
  const now=Date.now();
  const {start,end}=saoPauloDayBounds(now);
  const offlineAfter=Number(env.ROUTER_OFFLINE_AFTER_MS||90000);

  const [sites,routers,paid,revenue,fees,active,pending,visitors]=await Promise.all([
    env.DB.prepare(`SELECT id,name,mode,sales_enabled,portal_title,router_host_count,router_last_seen_at,active_event_id,created_at,updated_at FROM sites WHERE id=? ORDER BY created_at`).bind(siteId).all(),
    env.DB.prepare(`SELECT site_id,COUNT(*) AS total,SUM(CASE WHEN enabled=1 AND last_seen_at IS NOT NULL AND last_seen_at>=? THEN 1 ELSE 0 END) AS online,SUM(CASE WHEN enabled=0 THEN 1 ELSE 0 END) AS disabled FROM router_devices WHERE site_id=? GROUP BY site_id`).bind(now-offlineAfter,siteId).all(),
    env.DB.prepare(`SELECT site_id,COUNT(*) AS c FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<? GROUP BY site_id`).bind(siteId,start,end).all(),
    env.DB.prepare(`SELECT site_id,COALESCE(SUM(amount_cents),0) AS v FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<? GROUP BY site_id`).bind(siteId,start,end).all(),
    env.DB.prepare(`SELECT site_id,COALESCE(SUM(fee_cents),0) AS v FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<? GROUP BY site_id`).bind(siteId,start,end).all(),
    env.DB.prepare(`SELECT site_id,COUNT(*) AS c FROM access_grants WHERE site_id=? AND status='active' AND ends_at>? GROUP BY site_id`).bind(siteId,now).all(),
    env.DB.prepare(`SELECT site_id,COUNT(*) AS c FROM payments WHERE site_id=? AND status='pending' GROUP BY site_id`).bind(siteId).all(),
    env.DB.prepare(`SELECT site_id,COUNT(DISTINCT device_id) AS c FROM portal_visits WHERE site_id=? AND visited_at>=? AND visited_at<? GROUP BY site_id`).bind(siteId,start,end).all()
  ]);

  const map=(rows,key='c')=>Object.fromEntries((rows||[]).map(r=>[r.site_id,Number(r[key]||0)]));
  const rTotal=Object.fromEntries((routers.results||[]).map(r=>[r.site_id,Number(r.total||0)]));
  const rOnline=Object.fromEntries((routers.results||[]).map(r=>[r.site_id,Number(r.online||0)]));
  const rDisabled=Object.fromEntries((routers.results||[]).map(r=>[r.site_id,Number(r.disabled||0)]));
  const paidMap=map(paid.results), revenueMap=map(revenue.results,'v'), feeMap=map(fees.results,'v'), activeMap=map(active.results), pendingMap=map(pending.results), visitorMap=map(visitors.results);

  const siteRows=(sites.results||[]).map(s=>{
    const legacyOnline=(!rTotal[s.id]&&s.router_last_seen_at&&Number(s.router_last_seen_at)>=now-offlineAfter)?1:0;
    return {
    id:s.id,
    name:s.name||s.portal_title||s.id,
    mode:s.mode||'standard',
    salesEnabled:!!s.sales_enabled,
    routerTotal:rTotal[s.id]||(legacyOnline?1:0),
    routerOnline:rOnline[s.id]||legacyOnline,
    routerDisabled:rDisabled[s.id]||0,
    routerOffline:Math.max(0,(rTotal[s.id]||0)-(rOnline[s.id]||0)-(rDisabled[s.id]||0)),
    routerLegacy:!!legacyOnline,
    routerHostCount:Number(s.router_host_count||0),
    lastSeenAt:s.router_last_seen_at?Number(s.router_last_seen_at):null,
    visitorsToday:visitorMap[s.id]||0,
    paidToday:paidMap[s.id]||0,
    revenueTodayCents:revenueMap[s.id]||0,
    feesTodayCents:feeMap[s.id]||0,
    netTodayCents:(revenueMap[s.id]||0)-(feeMap[s.id]||0),
    activeGrants:activeMap[s.id]||0,
    pendingPayments:pendingMap[s.id]||0,
    activeEventId:s.active_event_id||null,
    updatedAt:Number(s.updated_at||0)
  };
  });

  const summary=siteRows.reduce((a,s)=>{
    a.sites++;
    a.routers+=s.routerTotal;
    a.routersOnline+=s.routerOnline;
    a.routersDisabled+=s.routerDisabled;
    a.routersOffline+=s.routerOffline;
    a.clients+=s.routerHostCount;
    a.visitors+=s.visitorsToday;
    a.sales+=s.paidToday;
    a.grossCents+=s.revenueTodayCents;
    a.netCents+=s.netTodayCents;
    a.activeGrants+=s.activeGrants;
    a.pendingPayments+=s.pendingPayments;
    return a;
  },{sites:0,routers:0,routersOnline:0,routersDisabled:0,routersOffline:0,clients:0,visitors:0,sales:0,grossCents:0,netCents:0,activeGrants:0,pendingPayments:0});

  return json({
    ok:true,
    currentSiteId:siteId,
    scope:{mode:'single-site',siteId,canSwitchSite:false},
    offlineAfterMs:offlineAfter,
    summary,
    sites:siteRows,
    services:{worker:true,d1:true,r2:!!env.MEDIA,mercadoPago:!!env.MP_ACCESS_TOKEN,webhook:!!env.MP_WEBHOOK_SECRET},
    generatedAt:now
  });
}

async function adminDashboard(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const now=Date.now();
  const {start,end}=saoPauloDayBounds(now);
  const site=await env.DB.prepare(`SELECT * FROM sites WHERE id=?`).bind(siteId).first();
  const event=site?.active_event_id
    ?await env.DB.prepare(`SELECT * FROM events WHERE id=?`).bind(site.active_event_id).first()
    :null;

  const previousStart=start-86400000;
  const [paid,revenue,fees,active,pending,attempts,groups,payments,todayRows,visitors,paymentFlow,previous]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS c FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<?`).bind(siteId,start,end).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS v FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<?`).bind(siteId,start,end).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(fee_cents),0) AS v FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<?`).bind(siteId,start,end).first(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM access_grants WHERE site_id=? AND status='active' AND ends_at>?`).bind(siteId,now).first(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM payments WHERE site_id=? AND status='pending'`).bind(siteId).first(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM access_attempts WHERE site_id=? AND status='active' AND ends_at>?`).bind(siteId,now).first(),
    env.DB.prepare(`SELECT pg.id,pg.code,pg.phone_e164,pg.max_devices,pg.expires_at,COUNT(gm.device_id) AS used_devices FROM party_groups pg LEFT JOIN group_members gm ON gm.group_id=pg.id WHERE pg.site_id=? AND pg.expires_at>? GROUP BY pg.id ORDER BY pg.created_at DESC LIMIT 20`).bind(siteId,now).all(),
    env.DB.prepare(`SELECT p.id,p.status,p.amount_cents,p.payer_email,p.phone_e164,p.created_at,p.approved_at,pl.name AS plan_name FROM payments p JOIN plans pl ON pl.id=p.plan_id WHERE p.site_id=? ORDER BY p.created_at DESC LIMIT 20`).bind(siteId).all(),
    env.DB.prepare(`SELECT approved_at,amount_cents FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<? ORDER BY approved_at`).bind(siteId,start,end).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT device_id) AS c FROM portal_visits WHERE site_id=? AND visited_at>=? AND visited_at<?`).bind(siteId,start,end).first(),
    env.DB.prepare(`SELECT COUNT(*) AS started,SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status IN ('failed','cancelled','expired','refunded') THEN 1 ELSE 0 END) AS failed FROM payments WHERE site_id=? AND created_at>=? AND created_at<?`).bind(siteId,start,end).first(),
    env.DB.prepare(`SELECT COUNT(*) AS sales,COALESCE(SUM(amount_cents),0) AS revenue FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<?`).bind(siteId,previousStart,start).first()
  ]);

  const hourly={};
  for(const r of todayRows.results){
    const d=new Date(Number(r.approved_at)-3*3600000);
    const h=String(d.getUTCHours()).padStart(2,"0")+":00";
    hourly[h]??={sales:0,revenueCents:0};
    hourly[h].sales++;
    hourly[h].revenueCents+=Number(r.amount_cents||0);
  }

  const gross=Number(revenue?.v||0);
  const fee=Number(fees?.v||0);
  const salesToday=Number(paid?.c||0);
  const visitorsToday=Number(visitors?.c||0);
  const paymentsStarted=Number(paymentFlow?.started||0);
  const previousSales=Number(previous?.sales||0);
  const previousRevenue=Number(previous?.revenue||0);
  const percentChange=(current,before)=>before>0?Math.round(((current-before)/before)*1000)/10:null;

  return json({
    ok:true,site,event,
    metrics:{
      routerOnline:!!site?.router_last_seen_at&&now-Number(site.router_last_seen_at)<=Number(env.ROUTER_OFFLINE_AFTER_MS||90000),
      routerHostCount:Number(site?.router_host_count||0),
      paidToday:salesToday,
      revenueTodayCents:gross,
      feesTodayCents:fee,
      netTodayCents:gross-fee,
      activeGrants:Number(active?.c||0),
      pendingPayments:Number(pending?.c||0),
      activeAttempts:Number(attempts?.c||0),
      visitorsToday,
      paymentStartsToday:paymentsStarted,
      failedPaymentsToday:Number(paymentFlow?.failed||0),
      conversionPct:visitorsToday?Math.round((salesToday/visitorsToday)*1000)/10:0,
      approvalPct:paymentsStarted?Math.round((Number(paymentFlow?.approved||0)/paymentsStarted)*1000)/10:0,
      averageTicketCents:salesToday?Math.round(gross/salesToday):0,
      netMarginPct:gross?Math.round(((gross-fee)/gross)*1000)/10:0,
      salesTrendPct:percentChange(salesToday,previousSales),
      revenueTrendPct:percentChange(gross,previousRevenue)
    },
    hourly:Object.entries(hourly).map(([hour,v])=>({hour,...v})),
    groups:groups.results,
    recentPayments:payments.results
  });
}
async function adminPlans(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const r=await env.DB.prepare(`SELECT * FROM plans WHERE site_id=? ORDER BY mode,sort_order,price_cents`).bind(siteId).all();
  return json({ok:true,plans:r.results});
}

async function adminPlanSave(request,env,id=null){
  let b;try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main",now=Date.now(),pid=id||uuid();
  const mode=["standard","party","both"].includes(b.mode)?b.mode:"standard";
  const name=String(b.name||"").trim();
  const slug=String(b.slug||name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")).slice(0,80);
  if(!name||!slug)return json({ok:false,error:"invalid_plan"},400);

  const price=Math.max(0,Math.round(Number(b.priceCents||0)));
  const eventEnd=b.partyUntilEventEnd?1:0;
  const duration=eventEnd?null:Math.max(60,Math.round(Number(b.durationSeconds||3600)));
  const max=Math.max(1,Math.min(20,Math.round(Number(b.maxDevices||1))));
  const enabled=b.enabled===false?0:1;
  const down=Math.max(0,Math.round(Number(b.rateDownKbps||0)));
  const up=Math.max(0,Math.round(Number(b.rateUpKbps||0)));

  if(id){
    await env.DB.prepare(`
      UPDATE plans
         SET mode=?,slug=?,name=?,price_cents=?,duration_seconds=?,party_until_event_end=?,
             max_devices=?,enabled=?,sort_order=?,rate_limit_down_kbps=?,rate_limit_up_kbps=?,
             updated_at=?
       WHERE id=? AND site_id=?
    `).bind(
      mode,slug,name,price,duration,eventEnd,max,enabled,Number(b.sortOrder||0),
      down,up,now,id,siteId
    ).run();
    await audit(env,siteId,"plan.update",{id,name,price,down,up});
  }else{
    await env.DB.prepare(`
      INSERT INTO plans(
        id,site_id,mode,slug,name,price_cents,duration_seconds,party_until_event_end,
        max_devices,enabled,sort_order,created_at,updated_at,rate_limit_down_kbps,rate_limit_up_kbps
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      pid,siteId,mode,slug,name,price,duration,eventEnd,max,enabled,
      Number(b.sortOrder||0),now,now,down,up
    ).run();
    await audit(env,siteId,"plan.create",{id:pid,name,price,down,up});
  }

  return json({ok:true,id:pid});
}
async function adminPlanDelete(env,id){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const refs=await env.DB.prepare(`SELECT COUNT(*) AS c FROM payments WHERE plan_id=?`).bind(id).first();
  if(Number(refs?.c||0)>0){
    await env.DB.prepare(`UPDATE plans SET enabled=0,updated_at=? WHERE id=? AND site_id=?`).bind(Date.now(),id,siteId).run();
    await audit(env,siteId,"plan.disable",{id});return json({ok:true,disabled:true});
  }
  await env.DB.prepare(`DELETE FROM plans WHERE id=? AND site_id=?`).bind(id,siteId).run();
  await audit(env,siteId,"plan.delete",{id});return json({ok:true,deleted:true});
}

async function adminConfigSave(request,env){
  let b;
  try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}

  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const mode=b.mode==="party"?"party":"standard";
  const bg=b.backgroundMode==="image"?"image":"gradient";

  let bgUrl=String(b.backgroundImageUrl||"").trim();
  if(bg==="image" && bgUrl && !bgUrl.startsWith("r2://") && !/^https:\/\//.test(bgUrl))bgUrl=null;
  if(bg!=="image")bgUrl=null;

  let logoUrl=String(b.logoImageUrl||"").trim();
  if(logoUrl && !logoUrl.startsWith("r2://") && !/^https:\/\//.test(logoUrl))logoUrl=null;

  const current=await env.DB.prepare(`
    SELECT privacy_policy_version,privacy_text,background_image_url,logo_image_url
      FROM sites WHERE id=?
  `).bind(siteId).first();

  if(bg==="image" && !bgUrl && String(current?.background_image_url||"").startsWith("r2://")) {
    bgUrl=String(current.background_image_url);
  }
  if(!logoUrl && String(current?.logo_image_url||"").startsWith("r2://")) {
    logoUrl=String(current.logo_image_url);
  }

  const privacyText=String(b.privacyText||"").slice(0,4000);
  const policyChanged=privacyText!==String(current?.privacy_text||"");
  const nextVersion=Number(current?.privacy_policy_version||1)+(policyChanged?1:0);

  await env.DB.prepare(`
    UPDATE sites SET
      mode=?,background_mode=?,background_image_url=?,support_whatsapp=?,
      require_whatsapp_standard=?,sales_enabled=?,portal_title=?,portal_subtitle=?,
      about_title=?,about_text=?,logo_image_url=?,
      notice_enabled=?,notice_title=?,notice_text=?,notice_starts_at=?,notice_ends_at=?,
      emergency_message=?,privacy_title=?,privacy_text=?,privacy_require_accept=?,
      privacy_policy_version=?,updated_at=?
    WHERE id=?
  `).bind(
    mode,bg,bgUrl,normalizePhone(b.supportWhatsapp)||null,
    b.requireWhatsappStandard?1:0,b.salesEnabled===false?0:1,
    String(b.portalTitle||"Open Wi-Fi").slice(0,80),
    String(b.portalSubtitle||"Escolha seu acesso, pague via Pix e conecte.").slice(0,180),
    String(b.aboutTitle||"Conheça o Open Wi-Fi").slice(0,100),
    String(b.aboutText||"").slice(0,1200),
    logoUrl||null,
    b.noticeEnabled?1:0,
    String(b.noticeTitle||"Aviso").slice(0,120),
    String(b.noticeText||"").slice(0,1200),
    Number(b.noticeStartsAt)||null,
    Number(b.noticeEndsAt)||null,
    String(b.emergencyMessage||"Novas vendas estão temporariamente pausadas.").slice(0,300),
    String(b.privacyTitle||"Privacidade e uso de dados").slice(0,120),
    privacyText,
    b.privacyRequireAccept?1:0,
    nextVersion,
    Date.now(),siteId
  ).run();

  await audit(env,siteId,"site.config",{
    mode,bg,salesEnabled:b.salesEnabled!==false,policyVersion:nextVersion
  });

  return json({ok:true,privacyPolicyVersion:nextVersion});
}
async function adminEventSave(request,env){
  let b;try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main",name=String(b.name||"").trim(),startsAt=Number(b.startsAt),endsAt=Number(b.endsAt);
  if(!name||!Number.isFinite(startsAt)||!Number.isFinite(endsAt)||endsAt<=startsAt)return json({ok:false,error:"invalid_event"},400);
  const site=await env.DB.prepare(`SELECT active_event_id FROM sites WHERE id=?`).bind(siteId).first(),id=site?.active_event_id||uuid(),now=Date.now();
  const status=now<startsAt?"scheduled":now>=endsAt?"ended":"active";
  if(site?.active_event_id)await env.DB.prepare(`UPDATE events SET name=?,starts_at=?,ends_at=?,status=?,updated_at=? WHERE id=? AND site_id=?`).bind(name,startsAt,endsAt,status,now,id,siteId).run();
  else{
    await env.DB.prepare(`INSERT INTO events(id,site_id,name,starts_at,ends_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id,siteId,name,startsAt,endsAt,status,now,now).run();
    await env.DB.prepare(`UPDATE sites SET active_event_id=?,updated_at=? WHERE id=?`).bind(id,now,siteId).run();
  }
  await audit(env,siteId,"event.save",{id,name,startsAt,endsAt});return json({ok:true,id,status});
}

async function adminGenerateCode(request,env){
  let b={};
  try{b=await request.json()}
  catch{b={}}

  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const site=await env.DB.prepare(`
    SELECT mode FROM sites WHERE id=?
  `).bind(siteId).first();

  if(!site) return json({ok:false,error:"site_not_found"},404);

  const accessType=b.accessType==="permanent"?"permanent":"minutes";
  const minutes=Math.max(1,Math.min(5256000,Math.round(Number(b.minutes||60))));
  const isPermanent=accessType==="permanent"?1:0;
  const durationSeconds=isPermanent?null:minutes*60;

  // O código é de uso único e pode ficar aguardando o resgate.
  // 9999 evita que "tempo do código" seja confundido com "tempo do acesso".
  const codeRedeemUntil=253402300799000;
  const now=Date.now();
  const code=await ensureUniqueAccessCode(env,siteId);
  const id=uuid();

  await env.DB.prepare(`
    INSERT INTO access_codes(
      id,site_id,code,mode,event_id,duration_seconds,expires_at,
      max_uses,uses,status,created_at,updated_at,is_permanent
    )
    VALUES(?,?,?,?,NULL,?,?,1,0,'active',?,?,?)
  `).bind(
    id,
    siteId,
    code,
    site.mode,
    durationSeconds,
    codeRedeemUntil,
    now,
    now,
    isPermanent
  ).run();

  await audit(env,siteId,"access_code.create",{
    code,
    mode:site.mode,
    accessType,
    minutes:isPermanent?null:minutes
  });

  return json({
    ok:true,
    code,
    mode:site.mode,
    accessType,
    minutes:isPermanent?null:minutes,
    permanent:!!isPermanent
  });
}
async function adminCodes(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const now=Date.now();

  await env.DB.prepare(`
    UPDATE access_codes
       SET status='expired',updated_at=?
     WHERE site_id=?
       AND status='active'
       AND expires_at<=?
  `).bind(now,siteId,now).run();

  const r=await env.DB.prepare(`
    SELECT code,mode,status,uses,max_uses,expires_at,redeemed_at,created_at,
           duration_seconds,is_permanent
      FROM access_codes
     WHERE site_id=?
     ORDER BY created_at DESC
     LIMIT 100
  `).bind(siteId).all();

  return json({ok:true,codes:r.results});
}

async function adminGroups(url,env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main",phone=normalizePhone(url.searchParams.get("phone")||"");
  let sql=`SELECT pg.id,pg.code,pg.phone_e164,pg.max_devices,pg.expires_at,pg.public_token,e.name AS event_name,COUNT(gm.device_id) AS used_devices FROM party_groups pg LEFT JOIN events e ON e.id=pg.event_id LEFT JOIN group_members gm ON gm.group_id=pg.id WHERE pg.site_id=?`;
  const binds=[siteId];if(phone){sql+=` AND pg.phone_e164 LIKE ?`;binds.push(`%${phone}%`)}sql+=` GROUP BY pg.id ORDER BY pg.created_at DESC LIMIT 50`;
  const r=await env.DB.prepare(sql).bind(...binds).all();
  return json({ok:true,groups:r.results.map(g=>({...g,public_url:`${env.OPENWIFI_BASE_URL||""}/group?token=${g.public_token}`}))});
}


async function adminUsers(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const now=Date.now();

  const rows=await env.DB.prepare(`
    SELECT
      d.id,
      d.hostname,
      d.payer_email,
      d.phone_e164,
      d.updated_at,
      GROUP_CONCAT(DISTINCT dm.mac) AS macs,
      MAX(rh.last_seen_at) AS last_seen_at,
      MAX(
        CASE
          WHEN ag.status='active' AND ag.starts_at<=? AND ag.ends_at>?
          THEN ag.ends_at
          ELSE NULL
        END
      ) AS active_until,
      SUM(
        CASE
          WHEN ag.status='active' AND ag.starts_at<=? AND ag.ends_at>?
          THEN 1 ELSE 0
        END
      ) AS active_grants
    FROM devices d
    LEFT JOIN device_macs dm
      ON dm.device_id=d.id AND dm.site_id=d.site_id
    LEFT JOIN router_hosts rh
      ON rh.site_id=d.site_id AND rh.mac=dm.mac
    LEFT JOIN access_grants ag
      ON ag.device_id=d.id AND ag.site_id=d.site_id
    WHERE d.site_id=?
    GROUP BY d.id
    ORDER BY
      CASE WHEN MAX(
        CASE WHEN ag.status='active' AND ag.ends_at>? THEN ag.ends_at END
      ) IS NOT NULL THEN 0 ELSE 1 END,
      COALESCE(MAX(rh.last_seen_at),d.updated_at) DESC
    LIMIT 250
  `).bind(now,now,now,now,siteId,now).all();

  return json({
    ok:true,
    users:rows.results.map(r=>({
      ...r,
      active_until:r.active_until?Number(r.active_until):null,
      active_grants:Number(r.active_grants||0),
      last_seen_at:r.last_seen_at?Number(r.last_seen_at):null,
      macs:r.macs?String(r.macs).split(","):[]
    }))
  });
}

async function adminRevokeUsersAccess(request,env){
  let b;
  try{b=await request.json()}
  catch{return json({ok:false,error:"invalid_json"},400)}

  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const ids=[...new Set(
    (Array.isArray(b.deviceIds)?b.deviceIds:[])
      .map(x=>String(x||"").trim())
      .filter(Boolean)
  )].slice(0,250);

  if(!ids.length) return json({ok:false,error:"no_users_selected"},400);

  const now=Date.now();
  const placeholders=ids.map(()=>"?").join(",");

  // Revoga qualquer acesso válido: compra, código, permanente ou grupo.
  const grants=await env.DB.prepare(`
    UPDATE access_grants
       SET status='revoked',
           updated_at=?
     WHERE site_id=?
       AND device_id IN (${placeholders})
       AND status='active'
       AND ends_at>?
  `).bind(now,siteId,...ids,now).run();

  // Também derruba uma eventual janela gratuita de 30 s.
  const attempts=await env.DB.prepare(`
    UPDATE access_attempts
       SET status='cancelled',
           updated_at=?
     WHERE site_id=?
       AND device_id IN (${placeholders})
       AND status='active'
  `).bind(now,siteId,...ids).run();

  await audit(env,siteId,"users.revoke_access",{
    deviceIds:ids,
    count:ids.length,
    reason:String(b.reason||"Encerrado manualmente pelo administrador").slice(0,180)
  });

  return json({
    ok:true,
    selected:ids.length,
    grantsRevoked:Number(grants?.meta?.changes||0),
    attemptsCancelled:Number(attempts?.meta?.changes||0)
  });
}

async function adminAudit(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const r=await env.DB.prepare(`SELECT action,details_json,created_at FROM admin_audit WHERE site_id=? ORDER BY created_at DESC LIMIT 100`).bind(siteId).all();
  return json({ok:true,audit:r.results});
}

function adminPage(){
return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Open Wi-Fi • Administração</title>
<link rel="icon" href="/assets/site-logo?site=openwifi-main">
<style>
:root{color-scheme:dark;--bg:#080B10;--panel:#11161D;--panel2:#171D26;--panel3:#0D1219;--line:#252D38;--line-strong:#435164;--text:#F5F7FA;--muted:#8C98A8;--accent:#00B8FF;--accent2:#0284C7;--danger:#EF4444;--warning:#F59E0B;--ok:#22C55E;--shadow:0 24px 80px rgba(0,0,0,.34);--soft-shadow:0 12px 32px rgba(0,0,0,.2)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 83% -8%,rgba(93,141,255,.17),transparent 31%),radial-gradient(circle at -8% 28%,rgba(85,222,237,.11),transparent 32%),linear-gradient(rgba(85,222,237,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(85,222,237,.025) 1px,transparent 1px),var(--bg);background-size:auto,auto,38px 38px,38px 38px,auto;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px}button,input,select,textarea{font:inherit}button{touch-action:manipulation}::selection{background:rgba(85,222,237,.24);color:#fff}
.shell{min-height:100vh;display:grid;grid-template-columns:282px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;padding:22px 16px;border-right:1px solid var(--line);background:rgba(10,15,27,.94);backdrop-filter:blur(18px);overflow:auto}.brand{display:flex;align-items:center;gap:11px;padding:4px 8px 22px}.logo{width:42px;height:42px;border-radius:13px;display:block;object-fit:contain;background:#0b1120;border:1px solid var(--line);padding:3px}.brand b{font-size:16px;letter-spacing:-.02em}.brand span{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.product-badge{display:inline-flex;align-items:center;gap:6px;margin-top:4px;padding:3px 7px;border:1px solid rgba(110,168,254,.25);background:rgba(110,168,254,.08);border-radius:999px;color:#a9caff;font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.nav-label{padding:16px 12px 6px;color:#65718b;font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.workspace-chip{display:flex;align-items:center;gap:9px;max-width:270px;border:1px solid var(--line);background:rgba(16,22,37,.72);padding:7px 10px;border-radius:13px}.workspace-dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px rgba(104,213,165,.08)}.workspace-chip b{font-size:11px}.workspace-chip span{display:block;color:var(--muted);font-size:9px;margin-top:1px}.platform-hero{position:relative;overflow:hidden;border:1px solid #2d3c5d;background:radial-gradient(circle at 88% 15%,rgba(139,124,246,.27),transparent 35%),radial-gradient(circle at 8% 85%,rgba(110,168,254,.20),transparent 34%),linear-gradient(135deg,#111a2f,#0d1424 58%,#101629);border-radius:24px;padding:26px;margin-bottom:16px;box-shadow:var(--shadow)}.platform-hero:after{content:"";position:absolute;right:-80px;bottom:-120px;width:300px;height:300px;border-radius:50%;border:1px solid rgba(255,255,255,.05)}.platform-kicker{color:#9fc3ff;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.13em}.platform-hero h2{font-size:30px;letter-spacing:-.04em;margin:8px 0 7px;max-width:680px}.platform-hero p{color:#a9b4c9;max-width:700px;margin:0;line-height:1.55;font-size:13px}.platform-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px;margin-bottom:16px}.platform-metric{border:1px solid var(--line);background:linear-gradient(150deg,rgba(18,26,44,.96),rgba(11,17,30,.96));border-radius:17px;padding:15px}.platform-metric span{display:block;color:var(--muted);font-size:10px}.platform-metric b{display:block;font-size:24px;margin-top:5px;letter-spacing:-.03em}.site-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.site-card{border:1px solid var(--line);background:linear-gradient(155deg,#11192b,#0c1322);border-radius:18px;padding:16px;transition:.18s ease}.site-card:hover{transform:translateY(-2px);border-color:#405171}.site-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.site-title{font-size:16px;font-weight:900}.site-id{font-size:9px;color:#65718b;margin-top:3px}.site-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:14px 0}.site-stat{background:#0a111e;border:1px solid #202b41;border-radius:11px;padding:9px}.site-stat span{display:block;color:var(--muted);font-size:9px}.site-stat b{display:block;margin-top:3px;font-size:12px}.service-strip{display:flex;gap:8px;flex-wrap:wrap}.service-pill{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);background:#0b1220;border-radius:99px;padding:6px 9px;font-size:10px;color:#b8c4da}.service-pill i{width:7px;height:7px;border-radius:50%;background:var(--ok)}.nav{display:grid;gap:4px;padding-bottom:70px}.nav button{display:flex;align-items:center;gap:11px;width:100%;border:0;background:transparent;color:var(--muted);padding:10px 12px;border-radius:12px;text-align:left;cursor:pointer}.nav button:hover{background:var(--panel2);color:var(--text)}.nav button.active{background:linear-gradient(90deg,rgba(110,168,254,.18),rgba(139,124,246,.10));color:var(--text);box-shadow:inset 3px 0 0 var(--accent)}.nav .ico{width:20px;text-align:center}.sidebar-foot{position:fixed;left:16px;bottom:18px;width:250px}
.main{min-width:0;padding:24px clamp(14px,3vw,38px) 54px}.topbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:20px}.topbar h1{font-size:25px;margin:0}.eyebrow{color:var(--muted);font-size:12px;margin-top:4px}.refresh-wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}.last-updated{color:var(--muted);font-size:10px;white-space:nowrap}.refresh-icon{display:inline-block;margin-right:5px}.btn.loading .refresh-icon{animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.mobile-nav{display:none}
.btn{border:1px solid var(--line);background:var(--panel2);color:var(--text);padding:10px 13px;border-radius:11px;cursor:pointer;font-weight:750}.btn:hover{border-color:#405171}.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#07101f}.btn.danger{background:rgba(255,107,122,.12);border-color:rgba(255,107,122,.35);color:#ff9aa5}.btn.warning{background:rgba(246,198,91,.12);border-color:rgba(246,198,91,.35);color:#ffe29a}.btn.ghost{background:transparent}.btn:disabled{opacity:.55;cursor:not-allowed}
.grid-metrics{display:grid;grid-template-columns:repeat(8,minmax(128px,1fr));gap:10px;margin-bottom:18px;overflow-x:auto;padding-bottom:3px}.metric{min-width:128px;background:linear-gradient(160deg,var(--panel),#11182a);border:1px solid var(--line);border-radius:16px;padding:14px}.metric .label{color:var(--muted);font-size:10px}.metric .value{font-size:21px;font-weight:900;margin-top:5px}
.card{background:linear-gradient(165deg,rgba(16,22,37,.98),rgba(13,19,33,.98));border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow);margin-bottom:14px}.section-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:15px}.section-head h2{margin:0;font-size:19px}.muted{color:var(--muted);font-size:12px;line-height:1.5}.hidden{display:none!important}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.row4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
label{display:block;color:var(--muted);font-size:11px;margin:9px 0 5px}input,select,textarea{width:100%;border:1px solid var(--line);background:#0b1120;color:var(--text);border-radius:11px;padding:10px 11px;outline:none}input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(110,168,254,.10)}textarea{min-height:110px;resize:vertical}.checkline{display:flex;align-items:flex-start;gap:8px;color:#c7d1e5;font-size:12px}.checkline input{width:auto;margin-top:2px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:13px}table{width:100%;border-collapse:collapse;font-size:12px;min-width:760px}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{position:sticky;top:0;background:#11192a;color:#a9b4c9;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
.status{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:99px;padding:4px 8px;font-size:10px}.status.ok{color:#9bc3ff;border-color:rgba(110,168,254,.35);background:rgba(110,168,254,.08)}.status.bad{color:#ff9aa5;border-color:rgba(255,107,122,.35);background:rgba(255,107,122,.08)}.status.warn{color:#ffe29a;border-color:rgba(246,198,91,.35);background:rgba(246,198,91,.08)}.status.good{color:#95e7c2;border-color:rgba(104,213,165,.35);background:rgba(104,213,165,.08)}
.login{max-width:410px;margin:11vh auto}.login .logo{width:54px;height:54px;border-radius:17px;margin-bottom:15px}.code-show{font-size:30px;font-weight:950;letter-spacing:.08em;background:linear-gradient(90deg,var(--accent),#b1a7ff);-webkit-background-clip:text;color:transparent;margin:12px 0}
.chart{display:flex;align-items:flex-end;gap:6px;height:180px;padding:15px 4px 4px;border-bottom:1px solid var(--line);overflow-x:auto}.barwrap{min-width:34px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px}.bar{width:24px;min-height:2px;background:linear-gradient(180deg,var(--accent),var(--accent2));border-radius:7px 7px 2px 2px}.barlabel{font-size:9px;color:var(--muted);white-space:nowrap}.barvalue{font-size:9px;color:#cbd6ea}
.diag-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.diag{border:1px solid var(--line);background:#0c1322;border-radius:14px;padding:13px}.diag b{display:block;margin:5px 0}.diag .lamp{width:9px;height:9px;border-radius:50%;display:inline-block;background:var(--warning);margin-right:6px}.diag .lamp.good{background:var(--ok)}.diag .lamp.bad{background:var(--danger)}
.preview{height:130px;border:1px dashed #3b4964;border-radius:13px;background:#0a101d;display:grid;place-items:center;overflow:hidden}.preview img{max-width:100%;max-height:100%;object-fit:contain}.emergency{border-color:rgba(246,198,91,.32);background:linear-gradient(160deg,rgba(246,198,91,.08),rgba(16,22,37,.98))}
.user-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mini{background:#0b1120;border:1px solid var(--line);border-radius:11px;padding:10px}.mini span{display:block;color:var(--muted);font-size:10px}.mini b{font-size:12px}
#toastStack{position:fixed;right:18px;bottom:18px;z-index:1500;display:grid;gap:9px;max-width:min(390px,calc(100vw - 30px))}.toast{background:#131b2e;border:1px solid #31405d;border-left:4px solid var(--accent);border-radius:13px;padding:12px 13px;box-shadow:var(--shadow);animation:toastIn .2s ease}.toast.error{border-left-color:var(--danger)}.toast.warn{border-left-color:var(--warning)}.toast b{display:block;font-size:13px;margin-bottom:2px}.toast span{color:var(--muted);font-size:11px}@keyframes toastIn{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
.modal-backdrop{position:fixed;inset:0;background:rgba(2,5,12,.76);backdrop-filter:blur(7px);z-index:1400;display:grid;place-items:center;padding:18px;overflow:auto}.modal{width:min(500px,100%);background:#111827;border:1px solid #34415d;border-radius:19px;padding:18px;box-shadow:0 30px 110px rgba(0,0,0,.55);max-height:92vh;overflow:auto}.modal.wide{width:min(900px,100%)}.modal h3{margin:0 0 7px}.modal p{color:var(--muted);font-size:13px;line-height:1.5}.modal .actions{justify-content:flex-end}.mobile-section-title{display:none}
@media(max-width:1080px){.site-grid{grid-template-columns:1fr 1fr}.platform-grid{grid-template-columns:repeat(2,1fr)}.diag-grid{grid-template-columns:repeat(2,1fr)}.row4{grid-template-columns:repeat(2,1fr)}}@media(max-width:980px){.platform-hero{padding:20px}.platform-hero h2{font-size:25px}.site-grid{grid-template-columns:1fr}.shell{display:block}.sidebar{display:none}.main{padding:16px 12px 46px}.topbar{align-items:flex-start}.topbar h1{font-size:21px}.mobile-nav{display:block;margin:12px 0 16px}.mobile-nav select{background:#11192a;font-weight:800}.mobile-section-title{display:block;color:var(--muted);font-size:11px;margin-bottom:7px;text-transform:uppercase;letter-spacing:.08em}.grid-metrics{grid-template-columns:repeat(8,150px);margin-left:-12px;margin-right:-12px;padding-left:12px;padding-right:12px}.card{padding:14px;border-radius:15px;box-shadow:none}.section-head{align-items:flex-start;flex-direction:column}.row,.row3,.row4{grid-template-columns:1fr}.actions .btn{flex:1 1 140px}#toastStack{left:12px;right:12px;bottom:12px;max-width:none}.diag-grid{grid-template-columns:1fr 1fr}.user-summary{grid-template-columns:1fr 1fr}}@media(max-width:540px){.platform-grid{grid-template-columns:1fr 1fr}.topbar{display:block}.refresh-wrap{margin-top:10px;justify-content:flex-start}.metric{min-width:145px}.card{border-left:0;border-right:0;border-radius:0;margin-left:-12px;margin-right:-12px;padding-left:14px;padding-right:14px}.table-wrap{border-left:0;border-right:0;border-radius:0;margin-left:-14px;margin-right:-14px}.section-head h2{font-size:18px}.diag-grid,.user-summary{grid-template-columns:1fr}}
/* Dashboard v1.4 — central de operação */
.sidebar{width:100%;background:rgba(6,16,25,.92);border-right-color:rgba(85,222,237,.12)}.brand{padding-bottom:18px}.brand b{font-size:17px}.product-badge{color:#9af0f7;border-color:rgba(85,222,237,.25);background:rgba(85,222,237,.08)}
.nav button{min-height:44px;font-size:14px;font-weight:720;border:1px solid transparent}.nav button:hover{border-color:rgba(85,222,237,.09);background:rgba(85,222,237,.055)}.nav button.active{background:linear-gradient(90deg,rgba(85,222,237,.16),rgba(93,141,255,.08));box-shadow:inset 3px 0 0 var(--accent);border-color:rgba(85,222,237,.08)}.nav .ico{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;background:rgba(255,255,255,.035);font-size:12px}.nav button.active .ico{background:rgba(85,222,237,.14);color:#aaf5fb}
.main{width:100%;max-width:1660px;margin:0 auto;padding-top:20px}.topbar{position:sticky;top:0;z-index:25;margin:-20px -10px 22px;padding:16px 10px 12px;background:linear-gradient(180deg,rgba(6,16,25,.97) 70%,rgba(6,16,25,0));backdrop-filter:blur(12px)}.topbar h1{font-size:26px;letter-spacing:-.035em}.eyebrow{font-size:12px;color:#7793a2}.workspace-chip{background:rgba(12,24,35,.92);border-color:rgba(85,222,237,.14)}
.btn{min-height:42px;padding:10px 14px;font-size:13px;border-color:var(--line);transition:transform .16s ease,border-color .16s ease,background .16s ease}.btn:hover:not(:disabled){transform:translateY(-1px);border-color:var(--line-strong)}.btn.primary{background:linear-gradient(135deg,#55deed,#6f91ff);color:#041219;box-shadow:0 8px 24px rgba(85,222,237,.14)}.btn:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:3px solid rgba(85,222,237,.3);outline-offset:2px}
.card{background:linear-gradient(160deg,rgba(13,27,39,.97),rgba(8,19,29,.97));border-color:rgba(121,166,188,.18);box-shadow:var(--soft-shadow)}.section-head h2{font-size:20px;letter-spacing:-.025em}.muted{font-size:14px;color:var(--muted)}label{font-size:14px;margin-top:11px}input,select,textarea{min-height:43px;font-size:14px;background:#08141e;border-color:var(--line)}table{font-size:14px}th{font-size:12px;background:#0d1d29}th,td{padding:12px}.status{font-size:12px;font-weight:800;letter-spacing:.025em}.status:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 12%,transparent)}
.platform-hero{display:grid;grid-template-columns:minmax(0,1fr) 250px;align-items:center;gap:34px;min-height:248px;padding:30px;border-radius:26px;border-color:rgba(85,222,237,.18);background:radial-gradient(circle at 72% 20%,rgba(93,141,255,.16),transparent 33%),linear-gradient(135deg,rgba(15,36,50,.98),rgba(7,19,29,.98));box-shadow:0 28px 90px rgba(0,0,0,.28)}.platform-hero:after{display:none}.platform-kicker{display:flex;align-items:center;gap:9px;color:#a9f3f8;font-size:12px}.live-pulse{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 5px rgba(56,214,155,.11)}.hero-date{color:var(--muted);font-size:12px;font-weight:650;letter-spacing:0;text-transform:none}.platform-hero h2{max-width:760px;margin:13px 0 9px;font-size:clamp(29px,4vw,44px);line-height:1.05;letter-spacing:-.055em}.platform-hero h2 span{color:#8cebf3}.platform-hero p{max-width:720px;font-size:15px;color:#a9bdc8}.hero-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:21px}.hero-actions .btn{position:relative;z-index:2}.hero-summary{display:flex;gap:14px;flex-wrap:wrap;margin-top:18px}.hero-summary span{display:flex;align-items:center;gap:7px;color:#a7bbc5;font-size:13px}.hero-summary i{width:6px;height:6px;border-radius:50%;background:var(--accent)}
.health-dial{--score:0;--health-color:var(--ok);justify-self:end;width:218px;height:218px;border-radius:50%;display:grid;place-items:center;position:relative;background:conic-gradient(var(--health-color) calc(var(--score)*1%),rgba(126,166,184,.12) 0);box-shadow:0 0 60px rgba(56,214,155,.08)}.health-dial:before{content:"";position:absolute;inset:12px;border-radius:50%;background:radial-gradient(circle at 50% 35%,#132c38,#081721 68%);border:1px solid rgba(255,255,255,.08)}.health-content{position:relative;text-align:center}.health-content strong{display:block;font-size:48px;line-height:1;font-weight:900;letter-spacing:-.07em}.health-content span{display:block;color:var(--muted);font-size:12px;margin-top:6px}.health-label{color:var(--health-color)!important;font-weight:800!important}.health-services{position:absolute;bottom:37px;display:flex;gap:5px}.health-services i{width:7px;height:7px;border-radius:50%;background:var(--ok)}.health-services i.off{background:var(--danger)}
.platform-grid{grid-template-columns:repeat(6,minmax(150px,1fr));gap:11px;margin:16px 0}.platform-metric{min-height:154px;padding:16px;display:flex;flex-direction:column;border-radius:18px;border-color:rgba(121,166,188,.18);background:linear-gradient(155deg,rgba(15,31,44,.98),rgba(8,19,29,.98));transition:transform .16s ease,border-color .16s ease}.platform-metric:hover{transform:translateY(-2px);border-color:rgba(85,222,237,.3)}.metric-topline{display:flex;align-items:center;justify-content:space-between;gap:8px}.platform-metric .metric-label{font-size:13px;color:var(--muted);font-weight:700}.metric-icon{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:rgba(85,222,237,.09);color:#9bf0f7;font-size:15px}.platform-metric b{font-size:27px;margin:17px 0 4px}.metric-note{margin-top:auto;color:#829aa7;font-size:12px;line-height:1.35}.metric-note.good{color:#8fe7c4}.metric-note.warn{color:#f9d88b}.metric-note.bad{color:#ff9eaa}.metric-bar{height:4px;margin-top:11px;border-radius:10px;background:rgba(255,255,255,.06);overflow:hidden}.metric-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--accent),var(--ok))}
.overview-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(310px,.65fr);gap:14px}.overview-grid>.card{height:100%}.attention-count{display:inline-grid;place-items:center;min-width:27px;height:27px;border-radius:9px;background:rgba(244,193,93,.11);color:#f7d27e;font-size:12px;font-weight:900}.attention-count.clear{background:rgba(56,214,155,.1);color:#83e5bb}.attention-list{display:grid;gap:8px}.attention-item{width:100%;display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:11px;text-align:left;color:var(--text);background:#091620;border:1px solid rgba(121,166,188,.16);border-radius:13px;padding:11px;cursor:pointer}.attention-item:hover{border-color:rgba(85,222,237,.3)}.attention-icon{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:rgba(244,193,93,.1);color:#f6cf78}.attention-item.danger .attention-icon{background:rgba(255,115,133,.1);color:#ff9eaa}.attention-item.good .attention-icon{background:rgba(56,214,155,.1);color:#8de9c2}.attention-copy b{display:block;font-size:13px}.attention-copy span{display:block;color:var(--muted);font-size:11px;margin-top:3px}.attention-arrow{color:#7893a1;font-size:18px}.quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.quick-action{min-height:93px;text-align:left;border:1px solid rgba(121,166,188,.16);border-radius:14px;padding:13px;background:linear-gradient(145deg,#0d202c,#091721);color:var(--text);cursor:pointer;transition:.16s ease}.quick-action:hover{border-color:rgba(85,222,237,.3);transform:translateY(-2px)}.quick-action i{display:grid;place-items:center;width:31px;height:31px;border-radius:10px;background:rgba(85,222,237,.1);color:#9af0f7;font-style:normal}.quick-action b{display:block;font-size:13px;margin-top:9px}.quick-action span{display:block;color:var(--muted);font-size:10px;margin-top:2px}
.site-grid{grid-template-columns:repeat(3,minmax(260px,1fr))}.site-card{position:relative;padding:18px;border-color:rgba(121,166,188,.17);background:linear-gradient(155deg,#0d202c,#08151f)}.site-card.current{border-color:rgba(85,222,237,.3);box-shadow:inset 0 3px 0 rgba(85,222,237,.65)}.site-title{font-size:17px}.site-id{font-size:12px}.site-stats{gap:8px}.site-stat{padding:10px;background:rgba(5,15,23,.72);border-color:rgba(121,166,188,.13)}.site-stat span{font-size:12px}.site-stat b{font-size:14px}.site-router-line{display:flex;align-items:center;gap:8px;margin:12px 0 2px;color:var(--muted);font-size:12px}.site-router-line .metric-bar{flex:1;margin:0}.service-strip{gap:9px}.service-pill{min-height:36px;padding:7px 11px;font-size:12px;background:#091721;border-color:rgba(121,166,188,.15)}
.local-overview{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:15px}.local-overview h2{margin:0 0 5px;font-size:23px;letter-spacing:-.035em}.local-badges{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.grid-metrics{grid-template-columns:repeat(auto-fit,minmax(148px,1fr));overflow:visible}.metric{min-width:0;min-height:125px;padding:15px;display:flex;flex-direction:column;background:linear-gradient(155deg,#0e202c,#091721);border-color:rgba(121,166,188,.17)}.metric .label{font-size:12px;font-weight:750;text-transform:uppercase;letter-spacing:.055em}.metric .value{font-size:25px;margin-top:13px;letter-spacing:-.045em}.metric .meta{margin-top:auto;padding-top:9px;color:#8299a6;font-size:12px}.metric .meta.good{color:#8ce6bf}.metric .meta.warn{color:#f6d17f}.metric .meta.bad{color:#ff9ca8}.insight-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.insight{padding:14px;border:1px solid rgba(121,166,188,.15);border-radius:14px;background:#091720}.insight span{display:block;color:var(--muted);font-size:12px}.insight b{display:block;font-size:20px;margin-top:5px}.insight small{display:block;color:#78919f;font-size:12px;margin-top:5px}.trend{font-weight:800}.trend.up{color:#7de1b5}.trend.down{color:#ff98a5}.trend.flat{color:#8da6b3}
.table-actionbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.table-actionbar input{width:min(330px,100%)}.table-actionbar select{width:180px}.result-count{color:var(--muted);font-size:12px;white-space:nowrap}.payment-status{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:99px;font-size:12px;font-weight:800;border:1px solid var(--line)}.payment-status:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.payment-status.approved{color:#83e4ba;background:rgba(56,214,155,.08);border-color:rgba(56,214,155,.25)}.payment-status.pending{color:#f6d17c;background:rgba(244,193,93,.08);border-color:rgba(244,193,93,.25)}.payment-status.failed,.payment-status.cancelled,.payment-status.expired,.payment-status.refunded{color:#ff9ba7;background:rgba(255,115,133,.08);border-color:rgba(255,115,133,.25)}.empty-row{text-align:center!important;padding:30px!important;color:var(--muted)}
.info{padding:12px 13px;border-radius:12px;background:rgba(85,222,237,.065);border:1px solid rgba(85,222,237,.17);color:#b8cdd7;font-size:13px;line-height:1.5}.chart{height:200px}.bar{width:27px;background:linear-gradient(180deg,#66e6f1,#668bff)}.barvalue{font-size:10px}.barlabel{font-size:10px}.emergency{border-color:rgba(244,193,93,.23);background:linear-gradient(155deg,rgba(244,193,93,.07),rgba(9,22,32,.98))}
@media(max-width:1360px){.platform-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.site-grid{grid-template-columns:repeat(2,minmax(260px,1fr))}.grid-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:1080px){.platform-hero{grid-template-columns:minmax(0,1fr) 200px}.health-dial{width:190px;height:190px}.overview-grid{grid-template-columns:1fr}.insight-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:980px){.topbar{position:static;margin:-16px 0 18px;padding:14px 0 0;background:transparent;backdrop-filter:none}.platform-hero{grid-template-columns:1fr}.health-dial{justify-self:start;width:170px;height:170px}.health-content strong{font-size:40px}.site-grid{grid-template-columns:1fr}.grid-metrics{grid-template-columns:repeat(2,minmax(0,1fr));overflow:visible;margin:0 0 18px;padding:0}.local-overview{flex-direction:column}.local-badges{justify-content:flex-start}.table-actionbar{width:100%}.table-actionbar input{flex:1}.table-actionbar select{width:160px}}
@media(max-width:620px){.platform-hero{padding:21px;border-radius:19px}.platform-hero h2{font-size:30px}.hero-actions .btn{width:100%}.platform-grid{grid-template-columns:1fr}.overview-grid{display:block}.overview-grid>.card{height:auto}.quick-grid{grid-template-columns:1fr 1fr}.grid-metrics{grid-template-columns:1fr 1fr}.metric{min-height:112px}.insight-grid{grid-template-columns:1fr 1fr}.table-actionbar{align-items:stretch;flex-direction:column}.table-actionbar input,.table-actionbar select{width:100%}.site-stats{grid-template-columns:1fr 1fr}.health-dial{width:155px;height:155px}.health-services{bottom:25px}.topbar .workspace-chip{max-width:100%}}
@media(max-width:390px){.quick-grid,.insight-grid,.grid-metrics{grid-template-columns:1fr}.platform-hero h2{font-size:27px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}

/* Dashboard v1.5 — Open Wi-Fi Command Center */
:root{--rail:#030a10;--rail-soft:#07121a;--context:#08141d;--surface:#0b1923;--surface-raised:#10232f;--surface-soft:#07131c;--hairline:rgba(151,195,211,.14);--hairline-strong:rgba(151,195,211,.28);--focus:rgba(104,232,241,.38)}
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.skip-link{position:fixed;left:16px;top:12px;z-index:3000;transform:translateY(-160%);padding:11px 15px;border-radius:10px;background:#fff;color:#02070b;font-weight:850;transition:transform .15s ease}.skip-link:focus{transform:none}button:focus-visible,a:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
body{background:radial-gradient(circle at 76% -18%,rgba(67,127,151,.15),transparent 34%),radial-gradient(circle at 19% 112%,rgba(56,214,155,.055),transparent 34%),#050e15}.shell{min-height:100vh;display:grid;grid-template-columns:84px 278px minmax(0,1fr)}
.command-rail{position:sticky;top:0;z-index:90;height:100vh;display:flex;flex-direction:column;align-items:center;padding:15px 9px 13px;background:linear-gradient(180deg,#02080d,#040d13 72%,#061017);border-right:1px solid rgba(134,191,210,.11);box-shadow:10px 0 34px rgba(0,0,0,.18)}.rail-brand{width:52px;height:52px;display:grid;place-items:center;border:1px solid rgba(104,232,241,.18);border-radius:17px;background:linear-gradient(145deg,rgba(104,232,241,.09),rgba(93,141,255,.04));box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 12px 30px rgba(0,0,0,.26)}.rail-brand .logo{width:38px;height:38px;border:0;background:transparent;border-radius:12px;padding:2px}.rail-domains{position:relative;display:flex;flex:1;min-height:0;width:100%;flex-direction:column;justify-content:center;gap:6px;margin:12px 0}.rail-domains:before{content:"";position:absolute;left:50%;top:7%;bottom:7%;width:1px;background:linear-gradient(transparent,rgba(104,232,241,.12),transparent);pointer-events:none}.domain-button{position:relative;z-index:1;width:66px;min-height:64px;margin:0 auto;padding:7px 4px;border:1px solid transparent;border-radius:16px;background:transparent;color:#76909e;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;cursor:pointer;transition:background .16s ease,border-color .16s ease,color .16s ease,transform .16s ease}.domain-button:hover{color:#d9f4f7;background:#0a1821;border-color:rgba(104,232,241,.12);transform:translateY(-1px)}.domain-button[aria-pressed="true"]{color:#a9f7fb;background:linear-gradient(145deg,rgba(104,232,241,.14),rgba(57,113,139,.08));border-color:rgba(104,232,241,.23);box-shadow:0 10px 25px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.05)}.domain-button[aria-pressed="true"]:before{content:"";position:absolute;left:-10px;width:3px;height:28px;border-radius:0 5px 5px 0;background:#68e8f1;box-shadow:0 0 15px rgba(104,232,241,.65)}.domain-button svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.domain-button span{font-size:10px;font-weight:760;letter-spacing:-.01em}.rail-tools{display:grid;gap:7px}.rail-tool{width:48px;height:48px;padding:0;display:grid;place-items:center;border:1px solid transparent;border-radius:14px;background:transparent;color:#7d96a3;cursor:pointer}.rail-tool:hover{color:#d8f3f6;background:#0b1922;border-color:var(--hairline)}.rail-tool svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.context-panel{position:sticky;top:0;z-index:80;height:100vh;min-height:0;display:flex;flex-direction:column;padding:18px 16px 14px;background:linear-gradient(180deg,rgba(8,20,29,.985),rgba(6,17,25,.985));border-right:1px solid var(--hairline);box-shadow:18px 0 60px rgba(0,0,0,.12);overflow:hidden}.context-product{display:flex;align-items:center;gap:11px;padding:2px 2px 15px}.context-product strong{display:block;font-size:16px;letter-spacing:-.025em}.context-product span{display:block;margin-top:2px;color:#78939f;font-size:12px}.context-close{display:none!important;margin-left:auto}.icon-button{width:42px;height:42px;padding:0;display:grid;place-items:center;border:1px solid var(--hairline);border-radius:12px;background:var(--surface-soft);color:var(--text);cursor:pointer}.icon-button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.workspace-selector{width:100%;min-height:64px;display:grid;grid-template-columns:34px minmax(0,1fr) 16px;align-items:center;gap:10px;padding:10px;border:1px solid rgba(104,232,241,.14);border-radius:15px;background:linear-gradient(145deg,rgba(104,232,241,.065),rgba(255,255,255,.018));color:var(--text);text-align:left;cursor:pointer}.workspace-selector:hover{border-color:rgba(104,232,241,.28);background:linear-gradient(145deg,rgba(104,232,241,.095),rgba(255,255,255,.025))}.workspace-signal{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:#0d2631;color:#8bf1f6}.workspace-signal svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}.workspace-copy{min-width:0}.workspace-copy b,.workspace-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.workspace-copy b{font-size:14px}.workspace-copy span{margin-top:2px;color:#89a2ae;font-size:12px}.workspace-chevron{color:#78939f;font-size:17px}
.context-heading{padding:22px 5px 12px}.domain-kicker{display:flex;align-items:center;gap:7px;color:#74dce5;font-size:11px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.domain-kicker:before{content:"";width:16px;height:1px;background:#5cdce7}.context-heading h2{margin:7px 0 5px;font-size:24px;letter-spacing:-.045em}.context-heading p{min-height:36px;margin:0;color:#8ca5b0;font-size:13px;line-height:1.45}.mobile-domain-switcher{display:none}
.context-nav{flex:1;min-height:0;overflow:auto;padding:4px 2px 12px;scrollbar-width:thin;scrollbar-color:#29414e transparent}.nav-group{display:grid;gap:7px}.context-nav button{width:100%;min-height:62px;display:grid;grid-template-columns:38px minmax(0,1fr) 18px;align-items:center;gap:10px;padding:9px 10px;border:1px solid transparent;border-radius:14px;background:transparent;color:#91a9b5;text-align:left;cursor:pointer;transition:.16s ease}.context-nav button:hover{color:#eaf9fb;background:rgba(255,255,255,.025);border-color:var(--hairline)}.context-nav button.active{color:#f4fdfe;background:linear-gradient(100deg,rgba(104,232,241,.105),rgba(104,232,241,.025));border-color:rgba(104,232,241,.2);box-shadow:inset 3px 0 0 #68e8f1}.nav-item-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:rgba(136,179,195,.055);color:#8ca9b5}.context-nav button.active .nav-item-icon{background:rgba(104,232,241,.12);color:#aaf7fb}.nav-item-icon svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}.nav-item-copy{min-width:0}.nav-item-copy b,.nav-item-copy small{display:block}.nav-item-copy b{font-size:14px;letter-spacing:-.01em}.nav-item-copy small{margin-top:3px;color:#718995;font-size:11px;line-height:1.3}.context-nav button.active small{color:#91acb7}.nav-item-arrow{color:#59727e;font-size:18px}.context-nav button.active .nav-item-arrow{color:#76dde6}
.context-footer{display:grid;gap:8px;padding-top:10px;border-top:1px solid var(--hairline)}.system-glance{width:100%;min-height:54px;display:grid;grid-template-columns:10px minmax(0,1fr) 18px;align-items:center;gap:10px;padding:9px 10px;border:1px solid var(--hairline);border-radius:14px;background:rgba(255,255,255,.018);color:var(--text);text-align:left;cursor:pointer}.system-glance:hover{border-color:rgba(104,232,241,.24)}.system-dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px rgba(56,214,155,.09)}.system-dot.warn{background:var(--warning);box-shadow:0 0 0 4px rgba(244,193,93,.09)}.system-dot.bad{background:var(--danger);box-shadow:0 0 0 4px rgba(255,115,133,.09)}.system-copy b,.system-copy span{display:block}.system-copy b{font-size:13px}.system-copy span{margin-top:2px;color:#78929e;font-size:11px}.system-arrow{color:#607985}
.profile-area{position:relative}.profile-trigger{width:100%;min-height:58px;display:grid;grid-template-columns:38px minmax(0,1fr) 18px;align-items:center;gap:10px;padding:8px;border:1px solid transparent;border-radius:14px;background:transparent;color:var(--text);text-align:left;cursor:pointer}.profile-trigger:hover,.profile-trigger[aria-expanded="true"]{background:rgba(255,255,255,.025);border-color:var(--hairline)}.profile-avatar{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(145deg,#174354,#102c38);border:1px solid rgba(104,232,241,.16);color:#bdfafd;font-size:13px;font-weight:900}.profile-copy{min-width:0}.profile-copy b,.profile-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.profile-copy b{font-size:13px}.profile-copy span{margin-top:2px;color:#78929e;font-size:11px}.profile-more{color:#718a96;font-size:18px}.profile-menu{position:absolute;left:0;right:0;bottom:66px;padding:7px;border:1px solid var(--hairline-strong);border-radius:15px;background:#0d1d27;box-shadow:0 24px 70px rgba(0,0,0,.45)}.profile-menu button{width:100%;min-height:42px;display:flex;align-items:center;gap:9px;padding:9px 10px;border:0;border-radius:10px;background:transparent;color:#cfe2e8;text-align:left;cursor:pointer;font-size:13px}.profile-menu button:hover{background:rgba(255,255,255,.045)}.profile-menu button.danger-link{color:#ff9ca8}.profile-menu svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.main{grid-column:3;width:100%;max-width:none;min-width:0;margin:0;padding:18px clamp(18px,2.4vw,38px) 58px}.topbar{position:sticky;top:0;z-index:40;min-height:72px;margin:-18px calc(clamp(18px,2.4vw,38px)*-1) 20px;padding:13px clamp(18px,2.4vw,38px);display:flex;align-items:center;gap:18px;background:linear-gradient(180deg,rgba(5,14,21,.98) 78%,rgba(5,14,21,.8));border-bottom:1px solid rgba(136,179,195,.09);backdrop-filter:blur(20px)}.topbar-heading{min-width:170px}.breadcrumbs{display:flex;align-items:center;gap:6px;margin-bottom:3px;color:#69838f;font-size:11px}.breadcrumbs strong{color:#93aab4;font-weight:700}.topbar h1{font-size:23px;line-height:1.15;letter-spacing:-.035em}.topbar-tools{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-left:auto;min-width:0}.command-trigger{flex:1 1 380px;max-width:480px;min-width:230px;height:44px;display:flex;align-items:center;gap:9px;padding:0 10px 0 13px;border:1px solid var(--hairline);border-radius:13px;background:rgba(12,27,37,.78);color:#8ba4af;cursor:pointer;text-align:left}.command-trigger:hover{border-color:rgba(104,232,241,.27);color:#cbe5ea;background:#0d202b}.command-trigger svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round}.command-trigger .command-copy{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}.command-trigger kbd{padding:4px 7px;border:1px solid rgba(151,195,211,.17);border-radius:7px;background:#07131b;color:#718b97;font:700 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace}.top-attention{height:44px;display:flex;align-items:center;gap:7px;padding:0 12px;border:1px solid var(--hairline);border-radius:13px;background:rgba(12,27,37,.72);color:#a7bdc6;cursor:pointer}.top-attention:hover{border-color:rgba(104,232,241,.25)}.top-attention.has-items{color:#f7d88c;border-color:rgba(244,193,93,.24);background:rgba(244,193,93,.055)}.top-attention.has-items svg{filter:drop-shadow(0 0 8px rgba(244,193,93,.35))}.top-attention svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}.top-attention b{font-size:12px}.top-attention span{font-size:11px}.topbar .last-updated{font-size:11px}.topbar .btn{white-space:nowrap}.topbar .workspace-chip{display:none}
.card{border-color:var(--hairline);background:linear-gradient(155deg,rgba(12,27,37,.98),rgba(7,18,27,.98));box-shadow:0 13px 38px rgba(0,0,0,.15)}.card:hover{border-color:rgba(151,195,211,.2)}.platform-hero{min-height:188px;grid-template-columns:minmax(0,1fr) 174px;gap:26px;padding:24px 26px;border-radius:21px;background:radial-gradient(circle at 75% 5%,rgba(77,157,181,.15),transparent 34%),linear-gradient(135deg,rgba(13,34,45,.98),rgba(6,18,27,.98));box-shadow:0 20px 60px rgba(0,0,0,.2)}.platform-hero h2{font-size:clamp(27px,3vw,36px)}.health-dial{width:158px;height:158px}.health-dial:before{inset:9px}.health-content strong{font-size:39px}.health-services{bottom:24px}.platform-grid{gap:10px}.platform-metric{min-height:139px;border-radius:16px;background:linear-gradient(155deg,rgba(13,31,41,.98),rgba(7,18,27,.98))}.platform-metric b{font-size:25px;margin-top:13px}.quick-action,.attention-item,.insight,.site-card{box-shadow:inset 0 1px 0 rgba(255,255,255,.018)}
.mobile-dock,.mobile-scrim{display:none}.page-announcer{position:absolute}
.command-backdrop{align-items:start;padding-top:min(14vh,120px);background:rgba(1,6,10,.74)}.command-panel{width:min(680px,calc(100vw - 28px));overflow:hidden;border:1px solid rgba(104,232,241,.2);border-radius:20px;background:#0a1821;box-shadow:0 36px 120px rgba(0,0,0,.62)}.command-search-row{display:grid;grid-template-columns:24px minmax(0,1fr) 36px;align-items:center;gap:9px;padding:13px 14px;border-bottom:1px solid var(--hairline)}.command-search-row>svg{width:21px;height:21px;fill:none;stroke:#79a2b0;stroke-width:1.8;stroke-linecap:round}.command-search-row input{min-height:44px;padding:4px 0;border:0;background:transparent;box-shadow:none;font-size:16px}.command-search-row input:focus{border:0;box-shadow:none}.command-close{width:34px;height:34px;border:1px solid var(--hairline);border-radius:10px;background:#07131b;color:#8fa8b2;cursor:pointer}.command-meta{display:flex;justify-content:space-between;gap:12px;padding:10px 15px;color:#6f8893;font-size:11px}.command-results{max-height:min(56vh,470px);overflow:auto;padding:0 8px 9px}.command-result{width:100%;min-height:62px;display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:11px;padding:8px 10px;border:1px solid transparent;border-radius:13px;background:transparent;color:#d9ebef;text-align:left;cursor:pointer}.command-result:hover,.command-result.selected{background:rgba(104,232,241,.075);border-color:rgba(104,232,241,.14)}.command-mark{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:#102b36;color:#9cf5f9;font-size:12px;font-weight:900}.command-result b,.command-result span{display:block}.command-result b{font-size:14px}.command-result span{margin-top:2px;color:#78929e;font-size:12px}.command-result em{color:#68828d;font-size:11px;font-style:normal}.command-empty{padding:34px 18px;text-align:center;color:#8ca5b0;font-size:14px}
.preference-modal{width:min(560px,100%)}.preference-modal .section-head{flex-direction:row;align-items:center}.preference-list{display:grid;gap:9px;margin-top:16px}.preference-row{min-height:68px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;margin:0;padding:12px 13px;border:1px solid var(--hairline);border-radius:14px;background:#091720;color:var(--text);cursor:pointer}.preference-row b,.preference-row span{display:block}.preference-row b{font-size:14px}.preference-row span{margin-top:3px;color:#7e98a4;font-size:12px;line-height:1.4}.preference-row input{appearance:none;width:44px;height:24px;min-height:24px;padding:0;border:1px solid #36515e;border-radius:99px;background:#0a151c;position:relative;cursor:pointer}.preference-row input:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#718995;transition:transform .16s ease,background .16s ease}.preference-row input:checked{border-color:#52ced9;background:rgba(82,206,217,.16)}.preference-row input:checked:before{transform:translateX(20px);background:#91f2f7}.preference-note{margin-top:13px;color:#718b97;font-size:12px;line-height:1.5}
body.high-contrast{--bg:#000;--panel:#050d13;--panel2:#0b1821;--panel3:#0e202a;--line:#496675;--line-strong:#8eb3c1;--text:#fff;--muted:#c5d9e0;--hairline:rgba(210,239,247,.34);--hairline-strong:rgba(225,246,251,.55)}body.high-contrast .command-rail,body.high-contrast .context-panel,body.high-contrast .topbar{background:#02080c}body.high-contrast .card,body.high-contrast .platform-metric,body.high-contrast .site-card{border-color:rgba(221,244,250,.38)}body.high-contrast .muted,body.high-contrast .nav-item-copy small,body.high-contrast .context-heading p{color:#c8dbe1}body.large-text .context-nav button{min-height:70px}body.large-text .nav-item-copy b,body.large-text .profile-copy b,body.large-text .system-copy b{font-size:15px}body.large-text .nav-item-copy small,body.large-text .profile-copy span,body.large-text .system-copy span,body.large-text .breadcrumbs{font-size:12px}body.large-text .muted,body.large-text label,body.large-text table,body.large-text input,body.large-text select,body.large-text textarea{font-size:15px}body.large-text .metric .label,body.large-text .metric .meta,body.large-text .platform-metric .metric-label{font-size:13px}body.reduce-motion *,body.reduce-motion *:before,body.reduce-motion *:after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
@media(max-width:1280px){.shell{grid-template-columns:80px 258px minmax(0,1fr)}.command-trigger{max-width:380px}.context-panel{padding-left:13px;padding-right:13px}.main{padding-left:22px;padding-right:22px}.topbar{margin-left:-22px;margin-right:-22px;padding-left:22px;padding-right:22px}.top-attention span{display:none}}
@media(max-width:1120px){body.nav-open{overflow:hidden}.shell{grid-template-columns:80px minmax(0,1fr)}.command-rail{display:flex}.context-panel{position:fixed;left:80px;top:0;width:300px;transform:translateX(calc(-100% - 18px));transition:transform .2s ease;box-shadow:25px 0 90px rgba(0,0,0,.52)}.context-panel.open{transform:none}.context-close{display:grid!important}.main{grid-column:2}.mobile-scrim{position:fixed;inset:0 0 0 80px;z-index:65;background:rgba(1,6,10,.58);backdrop-filter:blur(3px)}.mobile-scrim.visible{display:block}.command-trigger{min-width:190px}.platform-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:980px){.shell{display:block}.command-rail{display:none}.context-panel{left:0;width:min(360px,calc(100vw - 34px));transform:translateX(calc(-100% - 18px));padding-bottom:18px}.mobile-scrim{inset:0}.main{display:block;padding:14px 14px 104px}.topbar{position:sticky;margin:-14px -14px 16px;padding:12px 14px;min-height:68px}.topbar-heading{min-width:0}.breadcrumbs{display:none}.topbar h1{font-size:21px}.topbar-tools{gap:6px}.command-trigger{flex:0 0 44px;min-width:44px;width:44px;padding:0;justify-content:center}.command-trigger .command-copy,.command-trigger kbd{display:none}.topbar .last-updated{display:none}.topbar .btn{width:44px;padding:0;font-size:0}.topbar .btn .refresh-icon{margin:0;font-size:18px}.top-attention{width:44px;padding:0;justify-content:center}.top-attention b,.top-attention span{display:none}.mobile-domain-switcher{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:2px 2px 10px}.mobile-domain-switcher button{min-height:44px;padding:7px 6px;border:1px solid var(--hairline);border-radius:11px;background:#091720;color:#839ca7;font-size:12px;cursor:pointer}.mobile-domain-switcher button[aria-pressed="true"]{border-color:rgba(104,232,241,.27);background:rgba(104,232,241,.08);color:#aef8fb}.mobile-dock{position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));z-index:60;height:74px;display:grid;grid-template-columns:repeat(5,1fr);padding:6px;border:1px solid rgba(151,195,211,.18);border-radius:20px;background:rgba(5,15,22,.94);box-shadow:0 24px 70px rgba(0,0,0,.48);backdrop-filter:blur(18px)}.mobile-dock button{min-width:0;border:0;border-radius:14px;background:transparent;color:#78929e;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;font-weight:760;cursor:pointer}.mobile-dock button.active,.mobile-dock button[aria-expanded="true"]{background:rgba(104,232,241,.09);color:#a8f7fb}.mobile-dock svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.platform-hero{grid-template-columns:minmax(0,1fr) 150px}.health-dial{width:142px;height:142px}.card{box-shadow:0 10px 30px rgba(0,0,0,.12)}}
@media(max-width:680px){.platform-hero{grid-template-columns:1fr;padding:20px}.health-dial{justify-self:start}.platform-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.overview-grid{display:grid}.quick-grid{grid-template-columns:1fr 1fr}.grid-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.card{margin-left:0;margin-right:0;padding:16px;border-left:1px solid var(--hairline);border-right:1px solid var(--hairline);border-radius:16px}.table-wrap{margin-left:0;margin-right:0;border-left:1px solid var(--line);border-right:1px solid var(--line);border-radius:12px}.section-head{gap:10px}.command-meta span:last-child{display:none}}
@media(max-width:420px){.platform-grid,.quick-grid,.grid-metrics,.insight-grid{grid-template-columns:1fr}.domain-button span{font-size:9px}.context-panel{width:calc(100vw - 18px)}.topbar h1{font-size:19px}.platform-hero h2{font-size:27px}}

/* v1.5.1: Dark Tech tokens, truthful states and compact operational layout. */
:root{--rail:#080B10;--context:#0D1219;--surface:#11161D;--surface-raised:#171D26;--surface-soft:#0D1219;--hairline:#252D38;--hairline-strong:#435164;--focus:#00B8FF;--radius:14px;--space:16px}
body{background:var(--bg)}
.command-rail,.context-panel{background:var(--context);box-shadow:none}
.topbar{background:rgba(8,11,16,.96)}
.card,.platform-metric,.metric,.site-card,.quick-action,.attention-item,.insight{background:var(--panel);border-color:var(--line);box-shadow:none}
.platform-hero{grid-template-columns:minmax(0,1fr) 240px;background:var(--panel3);border:1px solid var(--line);box-shadow:none;border-radius:var(--radius);gap:28px;padding:28px}
.platform-hero h2{font-family:Montserrat,Inter,ui-sans-serif,system-ui,sans-serif;font-size:clamp(26px,3vw,38px);line-height:1.14;letter-spacing:-.04em;margin:8px 0 12px;max-width:650px}
.platform-hero p{font-size:14px;color:var(--muted);max-width:610px}
.platform-kicker{color:var(--muted);text-transform:none;letter-spacing:0;font-size:12px;font-weight:500}.platform-kicker .live-pulse{display:none}
.hero-summary{font-size:12px}.hero-summary span{font-size:12px;color:var(--muted)}
.network-snapshot{border-left:1px solid var(--line);padding:10px 0 10px 26px;align-self:stretch;display:flex;flex-direction:column;justify-content:center;gap:8px}
.network-snapshot>span{color:var(--muted);font-size:12px}.network-snapshot strong{font-size:40px;letter-spacing:-.04em;font-weight:800;color:var(--text)}.network-snapshot small{color:var(--muted);font-size:12px;line-height:1.6}.network-snapshot .status{align-self:flex-start}
.platform-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.platform-metric{min-height:126px;border-radius:var(--radius);padding:18px}.platform-metric b{font-size:27px;margin:10px 0}.platform-metric .metric-label{text-transform:none;font-size:13px;color:var(--muted)}.metric-note{font-size:12px}.metric-icon{background:var(--surface-raised);color:var(--accent)}.metric-icon svg,.quick-action svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.platform-metric:hover,.site-card:hover,.quick-action:hover{transform:none;border-color:var(--line-strong)}
.nav-item-copy small,.context-heading p,.profile-copy span,.context-product span,.system-copy span,.breadcrumbs,.command-meta,.command-result span,.preference-note{color:var(--muted)}
.domain-kicker{text-transform:none;letter-spacing:0;color:var(--accent);font-size:12px}.domain-kicker:before{display:none}.context-heading h2{font-size:22px}
.domain-button[aria-pressed="true"],.context-nav button.active{color:var(--text);background:rgba(0,184,255,.08);border-color:rgba(0,184,255,.25);box-shadow:none}.domain-button[aria-pressed="true"]:before{background:var(--accent);box-shadow:none}.context-nav button.active .nav-item-icon{color:var(--accent);background:rgba(0,184,255,.1)}
.btn.primary{background:var(--accent2);border-color:var(--accent2);color:#fff;box-shadow:none}.btn.primary:hover{background:#0369A1}.btn,input,select{min-height:44px}.btn:disabled{cursor:not-allowed;opacity:.6}
.context-note{display:flex;align-items:flex-start;gap:16px;padding:18px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-soft);margin-bottom:18px}.context-note p{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.6}.context-note>div{min-width:0;flex:1}.context-note select{max-width:380px;margin-top:12px}.site-grid{grid-template-columns:1fr}.site-card{border-radius:var(--radius)}.site-stats{grid-template-columns:repeat(6,minmax(0,1fr))}.site-stat{background:var(--surface-soft);border-color:var(--line)}.site-id{overflow-wrap:anywhere}
.load-state{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;margin-bottom:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface-raised);font-size:13px;color:var(--muted)}.load-state.error{border-color:rgba(239,68,68,.4);color:#fca5a5}.load-state .btn{margin-left:auto;font-size:12px}.load-state.loading:before{content:"";width:14px;height:14px;border:2px solid var(--line-strong);border-top-color:var(--accent);border-radius:50%;animation:load-spin 1s linear infinite}@keyframes load-spin{to{transform:rotate(360deg)}}
.skeleton-card{height:126px;border:1px solid var(--line);border-radius:var(--radius);padding:20px;background:var(--panel)}.skeleton-card:before,.skeleton-card:after{content:"";display:block;height:12px;border-radius:4px;width:60%;background:var(--panel2);animation:load-pulse 1.5s ease-in-out infinite}.skeleton-card:after{height:26px;margin-top:20px;width:80%}@keyframes load-pulse{50%{opacity:.4}}
.tab[data-load-state="error"] .platform-grid,.tab[data-load-state="error"] .table-wrap{opacity:.55}.table-wrap{max-width:100%;overflow-x:auto}.empty-row{padding:28px!important;white-space:normal!important;color:var(--muted);text-align:center}.service-pill{background:var(--surface-soft);border-color:var(--line);font-size:12px;padding:10px 12px}.provision-steps{display:flex;gap:10px;flex-wrap:wrap;padding:0;list-style:none;margin:16px 0}.provision-steps li{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.provision-steps b{display:grid;place-items:center;width:26px;height:26px;background:var(--surface-raised);border:1px solid var(--line);border-radius:8px;color:var(--text)}
.tab,.card,.platform-hero,.row,.row3,.row4{min-width:0}textarea{max-width:100%}.card h2{line-height:1.3}#toastStack{bottom:100px}
@media(min-width:981px){#toastStack{bottom:20px}}
@media(max-width:1280px) and (min-width:981px){.topbar-tools .last-updated{display:none}.command-trigger{min-width:160px}.top-attention{padding:0 10px}}
@media(max-width:980px){.platform-hero{grid-template-columns:minmax(0,1fr) 200px}.site-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.context-note{flex-direction:column}.command-trigger{min-width:44px}}
@media(max-width:680px){.platform-hero{grid-template-columns:1fr;padding:20px}.network-snapshot{border-left:0;border-top:1px solid var(--line);padding:16px 0 0}.network-snapshot strong{font-size:32px}.platform-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.site-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.platform-metric{padding:14px}.platform-metric b{font-size:23px}.topbar{gap:8px}.topbar h1{font-size:18px}.hero-actions .btn{min-width:0}.load-state .btn{margin-left:0}}
@media(max-width:374px){.platform-grid{grid-template-columns:1fr}.topbar h1{font-size:16px}.topbar-tools{gap:4px}.top-attention{display:none}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}

</style></head>
<body>
<a class="skip-link" href="#mainContent">Pular para o conteúdo principal</a>
<div id="toastStack" role="status" aria-live="polite" aria-atomic="true"></div>
<div id="confirmModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmText"><div class="modal"><h3 id="confirmTitle">Confirmar</h3><p id="confirmText"></p><div class="actions"><button class="btn ghost" id="confirmCancel">Cancelar</button><button class="btn primary" id="confirmOk">Confirmar</button></div></div></div>

<div id="commandModal" class="modal-backdrop command-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="commandTitle" aria-describedby="commandHint"><div class="command-panel">
  <h2 id="commandTitle" class="sr-only">Busca e comandos</h2>
  <div class="command-search-row"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input id="commandSearch" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="commandResults" placeholder="Busque uma página ou ação…" autocomplete="off"><button id="commandClose" class="command-close" aria-label="Fechar busca">Esc</button></div>
  <div class="command-meta" id="commandHint"><span>Atalhos para páginas e ações autorizadas</span><span>↑↓ navegar • Enter abrir</span></div>
  <div id="commandResults" class="command-results" role="listbox" aria-label="Resultados da busca"></div>
</div></div>

<div id="accessibilityModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="accessibilityTitle" aria-describedby="accessibilityDescription"><div class="modal preference-modal">
  <div class="section-head"><div><h2 id="accessibilityTitle">Acessibilidade</h2><div class="muted" id="accessibilityDescription">Ajuste a interface para trabalhar com mais conforto.</div></div><button class="icon-button" id="accessibilityClose" aria-label="Fechar preferências"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button></div>
  <div class="preference-list">
    <label class="preference-row" for="prefContrast"><span><b>Contraste elevado</b><span>Reforça textos, contornos e estados importantes.</span></span><input id="prefContrast" type="checkbox" role="switch"></label>
    <label class="preference-row" for="prefLargeText"><span><b>Texto ampliado</b><span>Aumenta informações de leitura e controles principais.</span></span><input id="prefLargeText" type="checkbox" role="switch"></label>
    <label class="preference-row" for="prefMotion"><span><b>Reduzir movimentos</b><span>Desativa transições e animações não essenciais.</span></span><input id="prefMotion" type="checkbox" role="switch"></label>
  </div>
  <div class="preference-note">Suas preferências ficam salvas somente neste dispositivo.</div>
</div></div>

<div id="userModal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="userModalTitle"><div class="modal wide">
<div class="section-head"><div><h2 id="userModalTitle">Usuário</h2><div class="muted" id="userModalSub"></div></div><button class="btn ghost" id="closeUserModal">Fechar</button></div>
<div id="userSummary" class="user-summary"></div><div class="actions" id="userActions"><button class="btn primary" id="giveCourtesy">Liberar cortesia</button><button class="btn danger" id="revokeFromDetail">Encerrar acesso atual</button></div>
<div id="courtesyForm" class="card hidden" style="box-shadow:none;margin-top:12px"><h3 style="margin-top:0">Nova cortesia</h3><div class="row3"><div><label>Validade</label><select id="courtesyType"><option value="minutes">Por minutos</option><option value="event">Até o fim do evento</option><option value="permanent">Permanente</option></select></div><div id="courtesyMinutesWrap"><label>Minutos</label><input id="courtesyMinutes" type="number" min="1" value="60"></div><div><label>Descrição</label><input id="courtesyLabel" value="Cortesia administrativa"></div></div><div class="row"><div><label>Download Mbps (0 = livre)</label><input id="courtesyDown" type="number" min="0" value="0"></div><div><label>Upload Mbps (0 = livre)</label><input id="courtesyUp" type="number" min="0" value="0"></div></div><div class="actions"><button class="btn primary" id="saveCourtesy">Liberar cortesia</button><button class="btn ghost" id="cancelCourtesy">Cancelar</button></div></div>
<h3>MACs / último contato</h3><div id="userMacs" class="table-wrap"></div><h3>Pagamentos</h3><div id="userPayments" class="table-wrap"></div><h3>Acessos</h3><div id="userGrants" class="table-wrap"></div><h3>Tentativas de 30 s</h3><div id="userAttempts" class="table-wrap"></div>
</div></div>

<section id="loginBox" class="login card"><img class="logo brandLogo" src="/assets/site-logo?site=openwifi-main" alt="Open Wi-Fi"><h2 style="margin:0">Open Wi-Fi Control</h2><div class="muted" style="margin:5px 0 16px">Plataforma de gestão de hotspots, vendas e conectividade.</div><label for="user">Usuário</label><input id="user" value="admin" autocomplete="username"><label for="pass">Senha</label><input id="pass" type="password" autocomplete="current-password"><button class="btn primary" style="width:100%;margin-top:13px" id="login">Entrar</button><div class="muted" id="loginErr" role="alert" aria-live="polite" style="margin-top:9px"></div></section>

<div id="app" class="shell hidden">
<aside class="command-rail" aria-label="Áreas principais do sistema">
  <button class="rail-brand" data-domain="central" aria-label="Open Wi-Fi — abrir Central" title="Open Wi-Fi"><img class="logo brandLogo" src="/assets/site-logo?site=openwifi-main" alt=""></button>
  <nav class="rail-domains" aria-label="Áreas do sistema">
    <button class="domain-button" data-domain="central" aria-pressed="true" title="Central"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect></svg><span>Central</span></button>
    <button class="domain-button" data-domain="operation" aria-pressed="false" title="Operação"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21"></path></svg><span>Operação</span></button>
    <button class="domain-button" data-domain="people" aria-pressed="false" title="Pessoas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path></svg><span>Pessoas</span></button>
    <button class="domain-button" data-domain="revenue" aria-pressed="false" title="Receita"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"></path><path d="M2 19h22"></path></svg><span>Receita</span></button>
    <button class="domain-button" data-domain="network" aria-pressed="false" title="Rede"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"></path><path d="M2 9a14 14 0 0 1 20 0"></path></svg><span>Rede</span></button>
    <button class="domain-button" data-domain="management" aria-pressed="false" title="Gestão"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"></path><path d="M1 14h6M9 8h6M17 16h6"></path></svg><span>Gestão</span></button>
  </nav>
  <div class="rail-tools"><button class="rail-tool" id="accessibilityOpenRail" aria-label="Abrir preferências de acessibilidade" title="Acessibilidade"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="2"></circle><path d="M5 8h14M12 6v7M8 21l4-8 4 8M7 13l5-2 5 2"></path></svg></button></div>
</aside>

<aside class="context-panel" id="contextPanel" aria-label="Navegação contextual">
  <div class="context-product"><div><strong>Open Wi-Fi</strong><span>Gestão de hotspots • v1.5.1</span></div><button class="icon-button context-close" id="contextClose" aria-label="Fechar navegação"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button></div>
  <button class="workspace-selector" data-jump="hotspots" aria-label="Ver contexto do estabelecimento atual"><span class="workspace-signal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"></path></svg></span><span class="workspace-copy"><b id="workspaceName">Open Wi-Fi</b><span id="workspaceMeta">Estabelecimento atual</span></span><span class="workspace-chevron" aria-hidden="true">›</span></button>
  <div class="context-heading"><span class="domain-kicker" id="domainKicker">Central</span><h2 id="domainTitle">Visão de comando</h2><p id="domainDescription">Saúde, prioridades e decisões do dia em um só lugar.</p></div>
  <div class="mobile-domain-switcher" aria-label="Escolher área">
    <button data-domain="central" aria-pressed="true">Central</button><button data-domain="operation" aria-pressed="false">Operação</button><button data-domain="people" aria-pressed="false">Pessoas</button><button data-domain="revenue" aria-pressed="false">Receita</button><button data-domain="network" aria-pressed="false">Rede</button><button data-domain="management" aria-pressed="false">Gestão</button>
  </div>
  <nav class="context-nav" id="contextNav" aria-label="Páginas da área selecionada">
    <div class="nav-group" data-domain-panel="central"><button data-tab="platform" class="active"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect></svg></span><span class="nav-item-copy"><b>Visão geral</b><small>Saúde, alertas e prioridades</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button><button data-tab="hotspots"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h1M14 9h1"></path></svg></span><span class="nav-item-copy"><b>Estabelecimento</b><small>Hotspot e contexto de operação</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button></div>
    <div class="nav-group hidden" data-domain-panel="operation"><button data-tab="dash"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21"></path></svg></span><span class="nav-item-copy"><b>Operação do local</b><small>Movimento, vendas e acessos agora</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button><button data-tab="mode"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg></span><span class="nav-item-copy"><b>Modo e evento</b><small>Regras da operação e agenda ativa</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button></div>
    <div class="nav-group hidden" data-domain-panel="people"><button data-tab="users"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="4"></circle><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 11h6M19 8v6"></path></svg></span><span class="nav-item-copy"><b>Usuários e acesso</b><small>Pessoas, dispositivos e histórico</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button><button data-tab="codes"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16"></path></svg></span><span class="nav-item-copy"><b>Códigos</b><small>Convites, cortesia e acesso rápido</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button><button data-tab="groups"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><circle cx="17" cy="8" r="3"></circle><path d="M2 21v-2a5 5 0 0 1 10 0v2M12 21v-2a5 5 0 0 1 10 0v2"></path></svg></span><span class="nav-item-copy"><b>Duplas e grupos</b><small>Acessos compartilhados e ocupação</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button></div>
    <div class="nav-group hidden" data-domain-panel="revenue"><button data-tab="plans"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18M8 14h2M14 14h2"></path></svg></span><span class="nav-item-copy"><b>Produtos e velocidade</b><small>Planos, preços e limites de acesso</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button><button data-tab="reports"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"></path><path d="M2 19h22"></path></svg></span><span class="nav-item-copy"><b>Relatórios</b><small>Receita, conversão e desempenho</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button></div>
    <div class="nav-group hidden" data-domain-panel="network"><button data-tab="routers"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="9" rx="2"></rect><path d="M7 15h.01M11 15h.01M15 15h2M8 11V8a4 4 0 0 1 8 0v3"></path></svg></span><span class="nav-item-copy"><b>MikroTiks</b><small>Roteadores, instalação e telemetria</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button><button data-tab="diagnostics"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21"></path><circle cx="12" cy="12" r="10"></circle></svg></span><span class="nav-item-copy"><b>Diagnóstico</b><small>Serviços, integrações e reconciliação</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button></div>
    <div class="nav-group hidden" data-domain-panel="management"><button data-tab="portal" data-min-role="admin"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg></span><span class="nav-item-copy"><b>Portal e marca</b><small>Experiência do cliente e identidade</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button><button data-tab="team" data-min-role="admin"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M19 8v6M22 11h-6"></path></svg></span><span class="nav-item-copy"><b>Equipe e permissões</b><small>Acesso administrativo por função</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button><button data-tab="audit"><span class="nav-item-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"></path></svg></span><span class="nav-item-copy"><b>Auditoria</b><small>Histórico das mudanças no sistema</small></span><span class="nav-item-arrow" aria-hidden="true">›</span></button></div>
  </nav>
  <div class="context-footer">
    <button class="system-glance" data-jump="diagnostics"><span class="system-dot" id="navHealthDot"></span><span class="system-copy"><b id="navHealthLabel">Verificando operação</b><span id="navHealthMeta">Aguardando dados mais recentes</span></span><span class="system-arrow" aria-hidden="true">›</span></button>
    <div class="profile-area"><button class="profile-trigger" id="profileButton" aria-haspopup="menu" aria-expanded="false"><span class="profile-avatar" id="profileAvatar">OW</span><span class="profile-copy"><b id="profileName">Administrador</b><span id="roleLabel">Carregando perfil</span></span><span class="profile-more" aria-hidden="true">•••</span></button><div class="profile-menu hidden" id="profileMenu" role="menu"><button id="accessibilityOpenMenu" role="menuitem"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="2"></circle><path d="M5 8h14M12 6v7M8 21l4-8 4 8"></path></svg>Preferências de acessibilidade</button><button id="logoutSide" class="danger-link" role="menuitem"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path></svg>Encerrar sessão</button></div></div>
  </div>
</aside>

<div class="mobile-scrim" id="mobileScrim" aria-hidden="true"></div>
<main class="main" id="mainContent" tabindex="-1">
<div class="topbar"><div class="topbar-heading"><div class="breadcrumbs"><span id="breadcrumbDomain">Central</span><span aria-hidden="true">/</span><strong id="breadcrumbPage">Visão geral</strong></div><h1 id="pageTitle">Visão geral</h1></div><div class="topbar-tools"><button class="command-trigger" id="commandOpen" aria-label="Buscar páginas e ações" aria-haspopup="dialog" aria-controls="commandModal" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><span class="command-copy">Buscar páginas e ações…</span><kbd>Ctrl K</kbd></button><button class="top-attention" id="topAttention" data-jump="platform" data-focus="attentionList" aria-label="Abrir prioridades da operação"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path></svg><b id="topAttentionCount">—</b><span>prioridades</span></button><span class="last-updated" id="lastUpdated">—</span><button class="btn" id="refreshPanel" aria-label="Atualizar dados do painel"><span class="refresh-icon" aria-hidden="true">↻</span><span>Atualizar</span></button></div></div>
<div class="page-announcer sr-only" id="pageAnnouncer" aria-live="polite"></div>
<select id="mobileNav" class="sr-only" tabindex="-1" aria-hidden="true"><option value="platform">Visão geral</option><option value="hotspots">Estabelecimento</option><option value="dash">Operação do local</option><option value="routers">MikroTiks</option><option value="users">Usuários e Internet</option><option value="codes">Códigos</option><option value="groups">Duplas e Grupos</option><option value="plans">Produtos e Velocidade</option><option value="mode">Modo e Evento</option><option value="reports">Relatórios</option><option value="portal" data-min-role="admin">Portal / Marca</option><option value="diagnostics">Diagnóstico</option><option value="team" data-min-role="admin">Equipe</option><option value="audit">Auditoria</option></select>
<section id="platform" class="tab">
<div class="platform-hero">
  <div>
    <div class="platform-kicker"><i class="live-pulse"></i>Visão do estabelecimento <span class="hero-date" id="heroDate"></span></div>
    <h2>Acompanhe seu hotspot.</h2><span id="heroGreeting" class="sr-only">Olá</span>
    <p>Vendas, acessos e comunicação dos roteadores em uma visão do estabelecimento atual.</p>
    <div class="hero-actions"><button class="btn primary" data-jump="dash">Abrir operação do local</button><button class="btn ghost" data-jump="routers">Gerenciar MikroTiks</button></div>
    <div class="hero-summary"><span><i></i><b id="heroSites">—</b> estabelecimento</span><span><i></i><b id="heroRouters">—</b> roteadores online</span><span><i></i><b id="heroVisitors">—</b> visitantes hoje</span></div>
  </div>
  <div class="network-snapshot" id="networkSnapshot" aria-label="Comunicação dos roteadores">
    <span>Roteadores com sinal recente</span><strong id="networkCount">—</strong>
    <span class="status" id="networkLabel">Aguardando dados</span>
    <small id="networkMeta">O status considera o último contato com a plataforma.</small>
  </div>
</div>
<div class="platform-grid" id="platformMetrics"></div>
<div class="overview-grid">
  <div class="card"><div class="section-head"><div><h2>Atenção agora</h2><div class="muted">Prioridades calculadas a partir da operação atual.</div></div><span class="attention-count" id="attentionCount">—</span></div><div class="attention-list" id="attentionList" tabindex="-1"></div></div>
  <div class="card"><div class="section-head"><div><h2>Atalhos</h2><div class="muted">Ações frequentes, sem procurar no menu.</div></div></div><div class="quick-grid">
    <button class="quick-action" data-min-role="operator" data-jump="codes" data-focus="codeAccessType"><i>#</i><b>Gerar código</b><span>Acesso rápido ou cortesia</span></button>
    <button class="quick-action" data-min-role="admin" data-jump="routers" data-focus="routerName"><i>⌘</i><b>Nova MikroTik</b><span>Iniciar provisionamento</span></button>
    <button class="quick-action" data-jump="users" data-focus="userSearch"><i>⌁</i><b>Buscar usuário</b><span>Acesso, MAC e histórico</span></button>
    <button class="quick-action" data-jump="reports"><i>▥</i><b>Ver relatório</b><span>Vendas e conversão</span></button>
  </div></div>
</div>
<div class="context-note"><div><b id="currentSiteSummary">Estabelecimento atual</b><p>Indicadores limitados ao local configurado. Consulte o contexto e os roteadores deste hotspot.</p></div><button class="btn" data-jump="hotspots">Ver estabelecimento</button></div>
<div class="card"><div class="section-head"><div><h2>Serviços da plataforma</h2><div class="muted">Resposta do painel e configuração das integrações. Abra o diagnóstico para mais verificações.</div></div><button class="btn ghost" data-jump="diagnostics">Abrir diagnóstico</button></div><div id="serviceStrip" class="service-strip"></div></div>
</section>

<section id="hotspots" class="tab hidden">
<div class="context-note"><div><b>Contexto do estabelecimento</b><p id="siteScopeNote">Este painel opera no local configurado. A troca entre estabelecimentos ainda não está disponível.</p><label for="siteContext">Estabelecimento atual</label><select id="siteContext" disabled aria-describedby="siteScopeNote"><option>Carregando estabelecimento…</option></select></div><span class="status">Operação por local</span></div>
<div class="card"><div class="section-head"><div><h2>Seu hotspot</h2><div class="muted">Vendas de hoje e último estado conhecido da rede.</div></div><span class="status" id="platformStatus">Aguardando dados</span></div><div id="siteCards" class="site-grid"></div></div>
</section>

<section id="dash" class="tab hidden">
  <div class="local-overview"><div><h2 id="localTitle">Operação do local</h2><div class="muted" id="localContext">Indicadores de hoje e situação em tempo real.</div></div><div class="local-badges"><span class="status" id="modeBadge">MODO</span><span class="status" id="salesBadge">VENDAS</span></div></div>
  <div class="grid-metrics" id="metrics"></div>
  <div class="card"><div class="section-head"><div><h2>Leitura rápida de hoje</h2><div class="muted">Indicadores que ajudam a decidir o próximo passo.</div></div></div><div class="insight-grid">
    <div class="insight"><span>Ticket médio</span><b id="avgTicket">—</b><small id="revenueTrend">Comparação indisponível</small></div>
    <div class="insight"><span>Vendas por visitante</span><b id="conversionRate">—</b><small>Vendas / dispositivos únicos no portal</small></div>
    <div class="insight"><span>Aprovação dos pagamentos</span><b id="approvalRate">—</b><small id="paymentFlowMeta">—</small></div>
    <div class="insight"><span>Saldo bruto após taxas</span><b id="netMargin">—</b><small id="salesTrend">Comparação indisponível</small></div>
  </div></div>
  <div class="card emergency"><div class="section-head"><div><h2>Controle de operação</h2><div class="muted" id="salesStateText"></div></div><button class="btn warning" id="emergencyBtn" data-min-role="operator">Carregando…</button></div><div class="muted">Pausar vendas não derruba quem já possui acesso. Código e cortesia continuam disponíveis.</div></div>
  <div class="row"><div class="card"><h2>Vendas por hora</h2><div id="salesChart" class="chart" aria-label="Gráfico de vendas por hora"></div></div><div class="card"><h2>Receita por hora</h2><div id="revenueChart" class="chart" aria-label="Gráfico de receita por hora"></div></div></div>
  <div class="card"><div class="section-head"><div><h2>Pagamentos recentes</h2><div class="muted">Consulte os 20 pagamentos mais recentes deste estabelecimento.</div></div><div class="table-actionbar"><input id="paymentSearch" type="search" placeholder="Buscar plano, e-mail ou WhatsApp" aria-label="Buscar pagamentos"><select id="paymentStatus" aria-label="Filtrar status"><option value="all">Todos os status</option><option value="approved">Aprovados</option><option value="pending">Pendentes</option><option value="failed">Com problema</option></select><span class="result-count" id="paymentsCount"></span></div></div><div class="table-wrap"><table><thead><tr><th>Plano</th><th>Status</th><th>Valor</th><th>E-mail</th><th>WhatsApp</th><th>Hora</th></tr></thead><tbody id="payments"></tbody></table></div></div>
</section>


<section id="routers" class="tab hidden">
  <div class="card">
    <div class="section-head">
      <div>
        <h2>Infraestrutura MikroTik</h2>
        <div class="muted">Confira o último contato de cada roteador. O estado de instalação é exibido separadamente da conectividade.</div>
      </div>
      <button class="btn" id="reloadRouters">Atualizar roteadores</button>
    </div>
    <div class="insight-grid" id="routerMetrics" style="margin-bottom:16px"></div>
    <div class="table-actionbar" style="margin-bottom:14px"><input id="routerSearch" type="search" placeholder="Nome, modelo ou identidade" aria-label="Buscar roteadores"><select id="routerStatusFilter" aria-label="Filtrar roteadores"><option value="all">Todos os roteadores</option><option value="online">Online</option><option value="offline">Offline</option><option value="disabled">Desativados</option></select></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>Conexão</th><th>Equipamento</th><th>Modo</th><th>Instalação</th><th>Último contato</th><th>IP público</th><th>Ação</th></tr></thead>
        <tbody id="routersRows"></tbody>
      </table>
    </div>
  </div>

  <div class="card" data-min-role="admin">
    <div class="section-head">
      <div>
        <h2>Provisionar nova MikroTik</h2>
        <div class="muted">Gere o script de instalação, execute na MikroTik e acompanhe o primeiro contato. O modo completo ainda precisa de validação em uma RB limpa.</div>
      </div>
    </div>

    <ol class="provision-steps"><li><b>1</b> Escolha o modo</li><li><b>2</b> Gere e execute o script</li><li><b>3</b> Confira o contato e a instalação</li></ol>
    <div class="row3">
      <div><label>Nome no painel</label><input id="routerName" value="Nova MikroTik"></div>
      <div><label>Tipo de instalação</label>
        <select id="routerInstallMode">
          <option value="full">Instalação completa</option>
          <option value="hotspot">Integrar HotSpot existente</option>
          <option value="agent">Somente agente</option>
        </select>
      </div>
      <div><label>WAN</label><input id="routerWan" value="ether1"></div>
    </div>

    <div id="routerFullFields">
      <div class="row">
        <div><label>Portas LAN Open Wi-Fi</label><input id="routerLanPorts" value="ether2,ether3,ether4,ether5"><div class="muted">Separe por vírgula.</div></div>
        <div><label>HotSpot Server</label><input id="routerHotspot" value="openwifi-hotspot"></div>
      </div>
      <div class="row3">
        <div><label>Rede</label><input id="routerNetwork" value="10.77.0.0/24"></div>
        <div><label>Gateway</label><input id="routerGateway" value="10.77.0.1"></div>
        <div><label>Pool DHCP</label><input id="routerPool" value="10.77.0.10-10.77.0.254"></div>
      </div>
    </div>

    <div id="routerHotspotFields" class="hidden">
      <label>Nome do HotSpot Server existente</label><input id="routerHotspotExisting" value="openwifi-hotspot">
      <div class="muted" style="margin-top:5px">Esse modo não altera bridge, DHCP, IP ou NAT; instala portal, Walled Garden e agente no HotSpot informado.</div>
    </div>

    <div id="routerAgentInfo" class="hidden">
      <div class="info">Somente o agente Cloud será instalado. Nenhuma configuração de LAN, HotSpot, DHCP, NAT ou portal será modificada.</div>
    </div>

    <div class="actions"><button class="btn primary" id="generateRouterScript">Gerar script de instalação</button></div>
  </div>

  <div class="card hidden" id="routerScriptBox">
    <div class="section-head">
      <div>
        <h2>Script pronto para colar</h2>
        <div class="muted" id="routerScriptExpiry"></div>
      </div>
      <button class="btn primary" id="copyRouterScript">Copiar script</button>
    </div>
    <div class="info">O script contém apenas um token temporário de adoção. Depois que a RB se registra, esse token é inutilizado e a credencial permanente fica somente na própria MikroTik.</div>
    <textarea id="routerBootstrapScript" readonly style="min-height:430px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;margin-top:12px"></textarea>
    <div class="muted" style="margin-top:8px">Cole o conteúdo inteiro no Terminal RouterOS. Para instalação completa, a ether1 deve estar ligada a uma rede que forneça internet por DHCP ou a RB já deve possuir internet.</div>
  </div>
</section>

<section id="mode" class="tab card hidden"><div class="section-head"><div><h2>Modo e evento</h2><div class="muted">Configure operação padrão ou Party.</div></div></div><div class="row"><div><label>Modo ativo</label><select id="modeSel"><option value="standard">Padrão</option><option value="party">Party</option></select></div><div><label>Novas vendas</label><select id="sales"><option value="1">Ativas</option><option value="0">Pausadas</option></select></div></div><div class="actions"><button class="btn primary" id="saveMode" data-min-role="admin">Salvar modo</button></div><hr style="border:0;border-top:1px solid var(--line);margin:20px 0"><h3>Evento Party</h3><label>Nome</label><input id="eventName"><div class="row"><div><label>Início</label><input id="eventStart" type="datetime-local"></div><div><label>Fim</label><input id="eventEnd" type="datetime-local"></div></div><div class="actions"><button class="btn primary" id="saveEvent" data-min-role="admin">Salvar evento</button></div></section>

<section id="plans" class="tab card hidden"><div class="section-head"><div><h2>Produtos, preços e velocidade</h2><div class="muted">0 Mbps = sem limite do Open Wi-Fi.</div></div><button class="btn primary" id="newPlan" data-min-role="admin">Novo produto</button></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Modo</th><th>Preço</th><th>Duração</th><th>Disp.</th><th>Velocidade</th><th>Status</th><th>Ação</th></tr></thead><tbody id="plansRows"></tbody></table></div><div id="planForm" class="hidden" style="margin-top:18px"><input id="planId" type="hidden"><div class="row3"><div><label>Nome</label><input id="planName"></div><div><label>Slug</label><input id="planSlug"></div><div><label>Modo</label><select id="planMode"><option value="standard">Padrão</option><option value="party">Party</option><option value="both">Ambos</option></select></div></div><div class="row4"><div><label>Preço R$</label><input id="planPrice" type="number" step=".01"></div><div><label>Duração min</label><input id="planMinutes" type="number"></div><div><label>Máx. dispositivos</label><input id="planMax" type="number"></div><div><label>Ordem</label><input id="planSort" type="number" value="0"></div></div><div class="row"><div><label>Download Mbps</label><input id="planDown" type="number" min="0" value="0"></div><div><label>Upload Mbps</label><input id="planUp" type="number" min="0" value="0"></div></div><label class="checkline"><input id="planEventEnd" type="checkbox"> válido até o fim do evento</label><label class="checkline"><input id="planEnabled" type="checkbox" checked> produto ativo</label><div class="actions"><button class="btn primary" id="savePlan">Salvar produto</button><button class="btn ghost" id="cancelPlan">Cancelar</button></div></div></section>

<section id="users" class="tab card hidden"><div class="section-head"><div><h2>Usuários e Internet</h2><div class="muted">Localize pessoas, confira acessos e resolva situações sem sair da lista.</div></div><button class="btn" id="reloadUsers">Atualizar lista</button></div><div class="table-actionbar"><input id="userSearch" type="search" placeholder="Buscar nome, e-mail, WhatsApp ou MAC" aria-label="Buscar usuários"><select id="userStatusFilter" aria-label="Filtrar usuários por acesso"><option value="all">Todos os acessos</option><option value="active">Com acesso</option><option value="inactive">Sem acesso</option></select><span class="result-count" id="usersCount"></span></div><div class="row"><div><label>Motivo ao encerrar</label><input id="revokeReason" value="Acesso encerrado manualmente pelo administrador"></div><div><label>Ação em massa</label><button class="btn danger" id="revokeSelected" data-min-role="operator">Encerrar acesso selecionados</button></div></div><div class="muted" id="selectionCount" style="margin:10px 0">0 selecionados</div><div class="table-wrap"><table><thead><tr><th><input id="selectAllUsers" type="checkbox" style="width:auto" aria-label="Selecionar todos os usuários visíveis"></th><th>Usuário</th><th>MAC</th><th>Último contato</th><th>Acesso</th><th>Status</th><th>Ação</th></tr></thead><tbody id="usersRows"></tbody></table></div></section>

<section id="portal" class="tab hidden"><div class="card"><h2>Identidade e conteúdo</h2><div class="row"><div><label>Título</label><input id="portalTitle"></div><div><label>WhatsApp suporte</label><input id="supportWhatsapp"></div></div><label>Subtítulo</label><input id="portalSubtitle"><div class="row"><div><label>Título Conheça-nos</label><input id="aboutTitle"></div><div><label>Background</label><select id="bgMode"><option value="gradient">Sem imagem</option><option value="image">Com imagem</option></select></div></div><label>Texto Conheça-nos</label><textarea id="aboutText"></textarea><label class="checkline"><input id="requireWhatsappStandard" type="checkbox"> exigir WhatsApp no Padrão</label></div>
<div class="card"><h2>Logo e background</h2><div class="row"><div><label>Logo por URL HTTPS</label><input id="logoUrl"><label>Ou upload direto</label><input id="logoFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/avif"><div class="actions"><button class="btn primary" id="uploadLogo">Enviar logo</button><button class="btn danger" id="deleteLogo">Remover</button></div></div><div><label>Prévia</label><div class="preview"><img id="logoPreview" src="/assets/site-logo?site=openwifi-main"></div></div></div><div class="row" style="margin-top:12px"><div><label>Background por URL HTTPS</label><input id="bgUrl"><label>Ou upload direto</label><input id="backgroundFile" type="file" accept="image/png,image/jpeg,image/webp,image/avif"><div class="actions"><button class="btn primary" id="uploadBackground">Enviar background</button><button class="btn danger" id="deleteBackground">Remover</button></div></div><div><label>Prévia</label><div class="preview"><img id="backgroundPreview" src="/assets/site-background?site=openwifi-main"></div></div></div></div>
<div class="card"><h2>Aviso no captive portal</h2><label class="checkline"><input id="noticeEnabled" type="checkbox"> exibir aviso</label><div class="row"><div><label>Título</label><input id="noticeTitle"></div><div><label>Texto</label><input id="noticeText"></div></div><div class="row"><div><label>Início opcional</label><input id="noticeStart" type="datetime-local"></div><div><label>Fim opcional</label><input id="noticeEnd" type="datetime-local"></div></div><label>Mensagem de vendas pausadas</label><input id="emergencyMessage"></div>
<div class="card"><h2>Privacidade / LGPD</h2><label>Título</label><input id="privacyTitle"><label>Texto</label><textarea id="privacyText"></textarea><label class="checkline"><input id="privacyRequire" type="checkbox"> exigir aceite para liberar acesso</label></div><div class="actions"><button class="btn primary" id="savePortal">Salvar portal</button></div></section>

<section id="codes" class="tab card hidden"><h2>Códigos de acesso</h2><div class="row3"><div><label>Tipo</label><select id="codeAccessType"><option value="minutes">Por minutos</option><option value="permanent">Permanente</option></select></div><div id="codeMinutesWrap"><label>Minutos</label><input id="codeMinutes" type="number" min="1" value="60"></div><div style="display:flex;align-items:end"><button class="btn primary" style="width:100%" id="genCode" data-min-role="operator">Gerar código</button></div></div><div id="newCodeBox" class="hidden" style="margin:16px 0"><div class="code-show" id="newCode"></div><div class="muted" id="newCodeInfo"></div><button class="btn" id="copyNewCode">Copiar</button></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Modo</th><th>Acesso</th><th>Status</th><th>Uso</th></tr></thead><tbody id="codesRows"></tbody></table></div></section>

<section id="groups" class="tab card hidden"><div class="section-head"><div><h2>Duplas e grupos</h2><div class="muted">Ocupação e link do representante.</div></div><input id="groupPhone" style="max-width:260px" placeholder="Buscar WhatsApp"></div><div class="table-wrap"><table><thead><tr><th>Código</th><th>Evento</th><th>WhatsApp</th><th>Ocupação</th><th>Expira</th><th>Representante</th></tr></thead><tbody id="groupsRows"></tbody></table></div></section>

<section id="reports" class="tab hidden"><div class="card"><div class="section-head"><div><h2>Relatório do evento</h2><div class="muted">Vendas, conversão, faturamento e grupos.</div></div><select id="reportEvent" aria-label="Período do relatório" style="max-width:310px"><option value="">Hoje / evento ativo</option></select></div><div class="grid-metrics" id="reportMetrics"></div><div class="row"><div><h3>Vendas por hora</h3><div id="reportSalesChart" class="chart"></div></div><div><h3>Receita por hora</h3><div id="reportRevenueChart" class="chart"></div></div></div><h3>Produtos</h3><div class="table-wrap"><table><thead><tr><th>Produto</th><th>Vendas</th><th>Receita</th></tr></thead><tbody id="reportPlans"></tbody></table></div><div class="actions"><button class="btn" id="reloadReport">Atualizar relatório</button><button class="btn primary" id="downloadCsv">Exportar CSV</button></div></div></section>

<section id="diagnostics" class="tab hidden"><div class="card"><div class="section-head"><div><h2>Central de diagnóstico</h2><div class="muted">Situação dos componentes críticos.</div></div><button class="btn" id="reloadDiagnostics">Testar novamente</button></div><div id="diagGrid" class="diag-grid"></div></div><div class="card"><div class="section-head"><div><h2>Reconciliação Mercado Pago</h2><div class="muted">Compara as 20 Orders recentes e sincroniza divergências.</div></div><button class="btn primary" id="reconcileBtn" data-min-role="operator">Reconciliar agora</button></div><div id="reconcileResult" class="muted"></div></div></section>

<section id="team" class="tab hidden"><div class="card"><div class="section-head"><div><h2>Equipe do painel</h2><div class="muted">Administrador, Operador/Caixa e Somente leitura.</div></div><button class="btn primary" id="newAccount">Novo usuário</button></div><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Usuário</th><th>Papel</th><th>Status</th><th>Último login</th><th>Ação</th></tr></thead><tbody id="accountsRows"></tbody></table></div><div id="accountForm" class="card hidden" style="box-shadow:none;margin-top:14px"><input id="accountId" type="hidden"><div class="row3"><div><label>Nome</label><input id="accountName"></div><div><label>Usuário</label><input id="accountUser"></div><div><label>Papel</label><select id="accountRole"><option value="admin">Administrador</option><option value="operator">Operador / Caixa</option><option value="viewer">Somente leitura</option></select></div></div><label>Senha (mínimo 8; vazio ao editar mantém atual)</label><input id="accountPassword" type="password"><label class="checkline"><input id="accountEnabled" type="checkbox" checked> conta ativa</label><div class="actions"><button class="btn primary" id="saveAccount">Salvar</button><button class="btn ghost" id="cancelAccount">Cancelar</button></div></div></div></section>

<section id="audit" class="tab card hidden"><h2>Auditoria</h2><div id="auditRows"></div></section>
</main>
<nav class="mobile-dock" aria-label="Navegação principal no celular">
  <button data-tab="platform" data-mobile-domain="central" class="active"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"></rect><rect x="14" y="3" width="7" height="7" rx="2"></rect><rect x="3" y="14" width="7" height="7" rx="2"></rect><rect x="14" y="14" width="7" height="7" rx="2"></rect></svg><span>Central</span></button>
  <button data-tab="dash" data-mobile-domain="operation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21"></path></svg><span>Operação</span></button>
  <button data-tab="users" data-mobile-domain="people"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="4"></circle><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 11h6M19 8v6"></path></svg><span>Pessoas</span></button>
  <button data-tab="reports" data-mobile-domain="revenue"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19V3M2 19h22"></path></svg><span>Receita</span></button>
  <button id="mobileMore" aria-haspopup="true" aria-controls="contextPanel" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></svg><span>Mais</span></button>
</nav>
</div>

<script>
const $=id=>document.getElementById(id);
let state=null,platformState=null,me=null,plans=[],adminUsers=[],events=[],accounts=[],routers=[],currentUserId=null,lastGeneratedCode="",lastRouterScript="",confirmResolve=null,focusBeforeDialog=null,userFocusBeforeDialog=null,commandFocusBefore=null,accessibilityFocusBefore=null,contextFocusBefore=null,activeDomain="central",commandMatches=[],commandIndex=0;
const selectedUsers=new Set();
const ranks={viewer:1,operator:2,admin:3,owner:4};
const roleNames={viewer:"Somente leitura",operator:"Operador",admin:"Administrador",owner:"Proprietário"};
const titles={platform:"Visão geral",hotspots:"Estabelecimento",dash:"Operação do local",routers:"MikroTiks",mode:"Modo e evento",plans:"Produtos e velocidade",users:"Usuários e acesso",portal:"Portal e marca",codes:"Códigos",groups:"Duplas e grupos",reports:"Relatórios",diagnostics:"Diagnóstico",team:"Equipe e permissões",audit:"Auditoria"};
const domains={
  central:{kicker:"Central",title:"Visão de comando",description:"Saúde, prioridades e decisões do dia em um só lugar.",defaultTab:"platform"},
  operation:{kicker:"Operação",title:"Controle do local",description:"Movimento, vendas e regras da operação em tempo real.",defaultTab:"dash"},
  people:{kicker:"Pessoas",title:"Clientes e acesso",description:"Usuários, dispositivos, convites e acessos compartilhados.",defaultTab:"users"},
  revenue:{kicker:"Receita",title:"Inteligência comercial",description:"Produtos, preços, conversão e desempenho financeiro.",defaultTab:"reports"},
  network:{kicker:"Rede",title:"Infraestrutura",description:"MikroTiks, conectividade, integrações e diagnóstico.",defaultTab:"routers"},
  management:{kicker:"Gestão",title:"Administração",description:"Marca, equipe, permissões e histórico de mudanças.",defaultTab:"portal"}
};
const tabDomains={platform:"central",hotspots:"central",dash:"operation",mode:"operation",users:"people",codes:"people",groups:"people",plans:"revenue",reports:"revenue",routers:"network",diagnostics:"network",portal:"management",team:"management",audit:"management"};
const commandItems=[
  {id:"hotspots",mark:"HT",label:"Ver estabelecimento",detail:"Hotspot e contexto de operação",tab:"hotspots",keywords:"site local hotspot estabelecimento contexto"},
  {id:"overview",mark:"CE",label:"Abrir visão geral",detail:"Saúde, alertas e prioridades",tab:"platform",keywords:"central inicio resumo saúde"},
  {id:"operation",mark:"OP",label:"Abrir operação do local",detail:"Movimento, vendas e acessos agora",tab:"dash",keywords:"painel local hoje"},
  {id:"payments",mark:"PX",label:"Buscar pagamento",detail:"Plano, e-mail, WhatsApp ou status",tab:"dash",focus:"paymentSearch",keywords:"pix cobrança venda pendente aprovado"},
  {id:"users",mark:"US",label:"Buscar usuário ou dispositivo",detail:"Pessoa, telefone, e-mail ou MAC",tab:"users",focus:"userSearch",keywords:"cliente acesso internet mac telefone"},
  {id:"codes",mark:"#",label:"Gerar código de acesso",detail:"Convite, cortesia ou acesso rápido",tab:"codes",focus:"codeAccessType",role:"operator",keywords:"voucher convite cortesia"},
  {id:"groups",mark:"GR",label:"Ver duplas e grupos",detail:"Acessos compartilhados",tab:"groups",keywords:"festa party compartilhar"},
  {id:"routers",mark:"RB",label:"Gerenciar MikroTiks",detail:"Instalação, status e telemetria",tab:"routers",keywords:"roteador router rede provisionar"},
  {id:"new-router",mark:"+",label:"Adicionar nova MikroTik",detail:"Iniciar provisionamento seguro",tab:"routers",focus:"routerName",role:"admin",keywords:"instalar cadastrar roteador"},
  {id:"plans",mark:"PR",label:"Gerenciar produtos e velocidades",detail:"Planos, preços e limites",tab:"plans",keywords:"produto plano preço duração velocidade"},
  {id:"reports",mark:"RE",label:"Abrir relatórios",detail:"Receita, conversão e desempenho",tab:"reports",keywords:"financeiro vendas indicadores"},
  {id:"mode",mark:"EV",label:"Configurar modo e evento",detail:"Agenda e regras da operação",tab:"mode",keywords:"party padrão festa evento"},
  {id:"diagnostics",mark:"DG",label:"Executar diagnóstico",detail:"Serviços, integrações e conectividade",tab:"diagnostics",keywords:"saúde erro falha webhook mercado pago r2 d1"},
  {id:"portal",mark:"ID",label:"Editar portal e marca",detail:"Identidade e experiência do cliente",tab:"portal",role:"admin",keywords:"logo fundo visual captive",},
  {id:"team",mark:"EQ",label:"Gerenciar equipe e permissões",detail:"Usuários administrativos",tab:"team",role:"admin",keywords:"conta administrador operador acesso"},
  {id:"audit",mark:"AU",label:"Consultar auditoria",detail:"Histórico das mudanças",tab:"audit",keywords:"log histórico ações"}
];
function can(role){return(ranks[me?.role]||0)>=(ranks[role]||99)}function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m]))}function brl(c){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format((Number(c)||0)/100)}function dt(v){return v?new Date(Number(v)).toLocaleString("pt-BR"):"—"}function localInput(v){if(!v)return"";const d=new Date(Number(v)),z=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"T"+z(d.getHours())+":"+z(d.getMinutes())}function toMs(v){return v?new Date(v).getTime():null}function speedLabel(d,u){d=Number(d||0);u=Number(u||0);if(!d&&!u)return"Sem limite";return(d?Math.round(d/1000)+"↓":"∞↓")+" / "+(u?Math.round(u/1000)+"↑":"∞↑")+" Mbps"}function durationLabel(s,p){if(p)return"Permanente";s=Number(s||0);if(!s)return"Legado";if(s<3600)return Math.round(s/60)+" min";if(s%3600===0)return(s/3600)+" h";return Math.round(s/60)+" min"}
function norm(v){return String(v??"").normalize("NFD").split("").filter(ch=>{const c=ch.charCodeAt(0);return c<768||c>879}).join("").toLocaleLowerCase("pt-BR")}
function num(v){return new Intl.NumberFormat("pt-BR").format(Number(v)||0)}
function pct(v){return new Intl.NumberFormat("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:1}).format(Number(v)||0)+"%"}
function trendInfo(v){if(v===null||v===undefined||!Number.isFinite(Number(v)))return{text:"Sem base no dia anterior",tone:"flat"};const n=Number(v);if(n===0)return{text:"Estável em relação a ontem",tone:"flat"};return{text:(n>0?"↑ ":"↓ ")+pct(Math.abs(n))+" em relação a ontem",tone:n>0?"up":"down"}}
function paymentInfo(status){const key=String(status||"pending").toLowerCase(),labels={approved:"Aprovado",pending:"Pendente",failed:"Falhou",cancelled:"Cancelado",expired:"Expirado",refunded:"Estornado"};return{key:labels[key]?key:"pending",label:labels[key]||"Pendente",problem:["failed","cancelled","expired","refunded"].includes(key)}}
function metricIcon(kind){const paths={money:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 8v8M9 10h5M9 14h5"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',sales:'<path d="M5 4h14v17l-3-2-4 2-4-2-3 2Z M8 8h8M8 12h6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',wifi:'<path d="M3 9a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0M9 17a4 4 0 0 1 6 0M12 21h.01"/>'};return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[kind]||paths.wifi)+'</svg>'}
function platformMetric(label,value,icon,note,tone){return "<div class='platform-metric'><div class='metric-topline'><span class='metric-label'>"+esc(label)+"</span><span class='metric-icon'>"+metricIcon(icon)+"</span></div><b>"+esc(value)+"</b><span class='metric-note "+esc(tone||"")+"'>"+esc(note)+"</span></div>"}
function dashboardMetric(label,value,meta,tone){return"<div class='metric'><div class='label'>"+esc(label)+"</div><div class='value'>"+esc(value)+"</div><div class='meta "+esc(tone||"")+"'>"+esc(meta||"")+"</div></div>"}
function attentionItem(icon,title,text,jump,tone){return"<button class='attention-item "+esc(tone||"")+"' data-jump='"+esc(jump)+"'><span class='attention-icon' aria-hidden='true'>"+esc(icon)+"</span><span class='attention-copy'><b>"+esc(title)+"</b><span>"+esc(text)+"</span></span><span class='attention-arrow' aria-hidden='true'>›</span></button>"}
async function api(path,opt={}){const h={...(opt.headers||{})};if(!(opt.body instanceof FormData))h["content-type"]="application/json";const r=await fetch(path,{...opt,headers:h}),ct=r.headers.get("content-type")||"",d=ct.includes("application/json")?await r.json().catch(()=>({})):await r.text();if(!r.ok){const e=new Error(typeof d==="object"?(d.error||"Erro"):d);e.data=typeof d==="object"?d:{};e.status=r.status;if(r.status===401&&me){me=null;$("app").classList.add("hidden");$("loginBox").classList.remove("hidden");$("loginErr").textContent="Sua sessão expirou. Entre novamente."}throw e}return d}

const pageLoads=new Map();
function loadNotice(id,kind,message){const section=$(id);if(!section)return;let box=section.querySelector(":scope > .load-state");if(!box){box=document.createElement("div");section.prepend(box)}box.className="load-state "+kind;box.setAttribute("role",kind==="error"?"alert":"status");box.replaceChildren();const text=document.createElement("span");text.textContent=message;box.append(text);if(kind==="error"){const retry=document.createElement("button");retry.className="btn";retry.textContent="Tentar novamente";retry.dataset.retry=id;box.append(retry)}}
function emptyPage(id){const targets={plans:["plansRows","Nenhum produto cadastrado. Administradores podem criar o primeiro plano."],codes:["codesRows","Nenhum código gerado neste estabelecimento."],groups:["groupsRows","Nenhum grupo encontrado para esta consulta."],team:["accountsRows","Nenhuma conta adicional cadastrada."],reports:["reportPlans","Nenhuma venda de plano no período."],audit:["auditRows","Nenhum evento de auditoria registrado."]};const entry=targets[id];if(!entry)return;const el=$(entry[0]);if(el&&!el.textContent.trim()){if(el.tagName==="TBODY")el.innerHTML="<tr><td class='empty-row' colspan='"+el.closest("table").querySelectorAll("thead th").length+"'>"+esc(entry[1])+"</td></tr>";else el.textContent=entry[1]}}
function runLoad(id,loader,quiet=false){
  if(pageLoads.has(id))return pageLoads.get(id);
  const section=$(id);if(!section)return Promise.resolve(false);
  section.setAttribute("aria-busy","true");section.dataset.loadState="loading";
  if(!quiet||!section.dataset.loadedAt)loadNotice(id,"loading","Carregando dados…");
  if(id==="platform"&&!section.dataset.loadedAt)$("platformMetrics").innerHTML=Array(6).fill("<div class='skeleton-card' aria-hidden='true'></div>").join("");
  const task=Promise.resolve().then(loader).then(()=>{section.dataset.loadedAt=String(Date.now());section.dataset.loadState="ready";section.querySelector(":scope > .load-state")?.remove();emptyPage(id);return true}).catch(e=>{
    section.dataset.loadState="error";loadNotice(id,"error",section.dataset.loadedAt?"Falha na atualização. Os dados abaixo são da última consulta bem-sucedida, em "+dt(section.dataset.loadedAt)+".":"Não foi possível carregar os dados. Tente novamente.");
    if(id==="platform"){$("navHealthLabel").textContent="Atualização indisponível";$("navHealthMeta").textContent="Consulte o aviso na visão geral";$("navHealthDot").className="system-dot warn";$("networkLabel").textContent=section.dataset.loadedAt?"Dados desatualizados":"Dados indisponíveis";if(!section.dataset.loadedAt)$("platformMetrics").innerHTML="<p class='muted'>Indicadores indisponíveis.</p>"}
    return false;
  }).finally(()=>{section.removeAttribute("aria-busy");pageLoads.delete(id)});
  pageLoads.set(id,task);return task;
}
document.addEventListener("click",event=>{const button=event.target.closest("[data-retry]");if(button)loadCurrentPage(button.dataset.retry)});

function toast(t,x="",type="ok"){const b=document.createElement("div");b.className="toast "+(type==="error"?"error":type==="warn"?"warn":"");b.innerHTML="<b>"+esc(t)+"</b>"+(x?"<span>"+esc(x)+"</span>":"");$("toastStack").appendChild(b);setTimeout(()=>b.remove(),3600)}
function ask(t,x,l="Confirmar",danger=false){focusBeforeDialog=document.activeElement;$("confirmTitle").textContent=t;$("confirmText").textContent=x;$("confirmOk").textContent=l;$("confirmOk").className="btn "+(danger?"danger":"primary");$("confirmModal").classList.remove("hidden");requestAnimationFrame(()=>$("confirmOk").focus());return new Promise(r=>confirmResolve=r)}
function closeAsk(v){$("confirmModal").classList.add("hidden");if(confirmResolve){const r=confirmResolve;confirmResolve=null;r(v)}if(focusBeforeDialog&&typeof focusBeforeDialog.focus==="function")focusBeforeDialog.focus();focusBeforeDialog=null}
$("confirmCancel").onclick=()=>closeAsk(false);$("confirmOk").onclick=()=>closeAsk(true);$("confirmModal").onclick=e=>{if(e.target===$("confirmModal"))closeAsk(false)};
function applyRoleUI(){
  document.querySelectorAll("[data-min-role]").forEach(el=>{const ok=can(el.dataset.minRole);if(el.tagName==="OPTION")el.disabled=!ok;else el.classList.toggle("hidden",!ok)});
  const displayName=me?.displayName||me?.username||"Administrador";
  const roleName=roleNames[me?.role]||"Acesso administrativo";
  $("profileName").textContent=displayName;
  $("roleLabel").textContent=roleName;
  $("profileAvatar").textContent=displayName.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase()||"OW";
}
function setDomain(domain){
  const selected=domains[domain]?domain:"central";
  activeDomain=selected;
  const info=domains[selected];
  document.querySelectorAll("[data-domain]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.domain===selected)));
  document.querySelectorAll("[data-domain-panel]").forEach(panel=>panel.classList.toggle("hidden",panel.dataset.domainPanel!==selected));
  document.querySelectorAll("[data-mobile-domain]").forEach(button=>button.classList.toggle("active",button.dataset.mobileDomain===selected));
  $("mobileMore").classList.toggle("active",selected==="network"||selected==="management");
  $("domainKicker").textContent=info.kicker;
  $("domainTitle").textContent=info.title;
  $("domainDescription").textContent=info.description;
  $("breadcrumbDomain").textContent=info.kicker;
}
function firstAvailableDomainTab(domain){
  const panel=document.querySelector("[data-domain-panel='"+domain+"']");
  return [...(panel?.querySelectorAll("[data-tab]")||[])].find(button=>!button.classList.contains("hidden"))?.dataset.tab||"platform";
}
function syncContextPanel(){
  const compact=window.innerWidth<=1120;
  const panel=$("contextPanel");
  if(!compact){
    panel.classList.remove("open");
    panel.removeAttribute("aria-hidden");
    panel.inert=false;
    $("mobileScrim").classList.remove("visible");
    $("mobileMore").setAttribute("aria-expanded","false");
    document.body.classList.remove("nav-open");
  }else if(!panel.classList.contains("open")){
    panel.setAttribute("aria-hidden","true");
    panel.inert=true;
    if(panel.contains(document.activeElement))$("mainContent").focus({preventScroll:true});
  }
}
function openContextPanel(){
  if(window.innerWidth>1120)return;
  const panel=$("contextPanel");
  if(!panel.classList.contains("open"))contextFocusBefore=document.activeElement;
  panel.inert=false;
  panel.setAttribute("aria-hidden","false");
  panel.classList.add("open");
  $("mobileScrim").classList.add("visible");
  $("mobileMore").setAttribute("aria-expanded","true");
  document.body.classList.add("nav-open");
  requestAnimationFrame(()=>$('contextClose').focus());
}
function closeContextPanel(restoreFocus=true){
  const panel=$("contextPanel");
  const wasOpen=panel.classList.contains("open");
  panel.classList.remove("open");
  $("mobileScrim").classList.remove("visible");
  $("mobileMore").setAttribute("aria-expanded","false");
  document.body.classList.remove("nav-open");
  if(window.innerWidth<=1120){panel.setAttribute("aria-hidden","true");panel.inert=true}else{panel.removeAttribute("aria-hidden");panel.inert=false}
  if(wasOpen&&restoreFocus&&contextFocusBefore&&typeof contextFocusBefore.focus==="function")contextFocusBefore.focus();
  contextFocusBefore=null;
}
function chooseDomain(domain){
  setDomain(domain);
  if(window.innerWidth<=1120)openContextPanel();else switchTab(firstAvailableDomainTab(activeDomain));
}
function switchTab(id){
  if((id==="portal"||id==="team")&&!can("admin"))id="audit";
  if(!$(id))id="platform";
  setDomain(tabDomains[id]||"central");
  document.querySelectorAll(".tab").forEach(x=>x.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.querySelectorAll("[data-tab]").forEach(x=>{const active=x.dataset.mobileDomain?x.dataset.mobileDomain===(tabDomains[id]||"central"):x.dataset.tab===id;x.classList.toggle("active",active);if(active)x.setAttribute("aria-current","page");else x.removeAttribute("aria-current")});
  $("mobileNav").value=id;
  const title=titles[id]||"Open Wi-Fi";
  $("pageTitle").textContent=title;
  $("breadcrumbPage").textContent=title;
  $("pageAnnouncer").textContent="Página aberta: "+title;
  document.title=title+" • Open Wi-Fi";
  const contextWasOpen=$("contextPanel").classList.contains("open");
  closeContextPanel(false);
  if(contextWasOpen)requestAnimationFrame(()=>$("mainContent").focus({preventScroll:true}));
  window.scrollTo({top:0,behavior:document.body.classList.contains("reduce-motion")?"auto":"smooth"});
  loadCurrentPage(id);
}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
document.querySelectorAll("[data-domain]").forEach(b=>b.onclick=()=>chooseDomain(b.dataset.domain));
$("mobileNav").onchange=e=>switchTab(e.target.value);
$("mobileMore").onclick=()=>$("contextPanel").classList.contains("open")?closeContextPanel():openContextPanel();
$("contextClose").onclick=closeContextPanel;
$("mobileScrim").onclick=closeContextPanel;
let contextResizeTimer=null;
window.addEventListener("resize",()=>{clearTimeout(contextResizeTimer);contextResizeTimer=setTimeout(syncContextPanel,80)});
syncContextPanel();
document.addEventListener("click",e=>{const target=e.target.closest("[data-jump]");if(!target)return;const focusId=target.dataset.focus;switchTab(target.dataset.jump);if(focusId)setTimeout(()=>$(focusId)?.focus(),120)});

function renderCommandResults(){
  const query=norm($("commandSearch").value);
  commandMatches=commandItems.filter(item=>(!item.role||can(item.role))&&(!query||norm([item.label,item.detail,item.keywords].join(" ")).includes(query)));
  commandIndex=Math.max(0,Math.min(commandIndex,commandMatches.length-1));
  $("commandResults").innerHTML=commandMatches.map((item,index)=>"<button id='command-option-"+index+"' class='command-result "+(index===commandIndex?"selected":"")+"' data-command='"+esc(item.id)+"' role='option' aria-selected='"+(index===commandIndex?"true":"false")+"'><span class='command-mark'>"+esc(item.mark)+"</span><span><b>"+esc(item.label)+"</b><span>"+esc(item.detail)+"</span></span><em>"+esc(domains[tabDomains[item.tab]||"central"].kicker)+"</em></button>").join("")||"<div class='command-empty'>Nenhum resultado. Tente buscar pelo que deseja fazer.</div>";
  if(commandMatches.length){
    const activeId="command-option-"+commandIndex;
    $("commandSearch").setAttribute("aria-activedescendant",activeId);
    requestAnimationFrame(()=>$(activeId)?.scrollIntoView({block:"nearest"}));
  }else $("commandSearch").removeAttribute("aria-activedescendant");
}
function openCommandPalette(initial=""){
  if(!me||$("app").classList.contains("hidden"))return;
  const focusOrigin=document.activeElement;
  commandFocusBefore=$("contextPanel").contains(focusOrigin)?$("mobileMore"):$("profileMenu").contains(focusOrigin)?$("profileButton"):focusOrigin;
  closeContextPanel(false);
  toggleProfileMenu(false);
  commandIndex=0;
  $("commandSearch").value=initial;
  $("commandModal").classList.remove("hidden");
  $("commandOpen").setAttribute("aria-expanded","true");
  $("commandSearch").setAttribute("aria-expanded","true");
  renderCommandResults();
  requestAnimationFrame(()=>$("commandSearch").focus());
}
function closeCommandPalette(){
  $("commandModal").classList.add("hidden");
  $("commandOpen").setAttribute("aria-expanded","false");
  $("commandSearch").setAttribute("aria-expanded","false");
  $("commandSearch").removeAttribute("aria-activedescendant");
  if(commandFocusBefore&&typeof commandFocusBefore.focus==="function")commandFocusBefore.focus();
  commandFocusBefore=null;
}
function runCommand(id){
  const item=commandItems.find(x=>x.id===id);
  if(!item||item.role&&!can(item.role))return;
  closeCommandPalette();
  switchTab(item.tab);
  if(item.focus)setTimeout(()=>{const el=$(item.focus);if(el){el.focus();if(typeof el.select==="function"&&el.tagName==="INPUT")el.select()}},140);
}
$("commandOpen").onclick=()=>openCommandPalette();
$("commandClose").onclick=closeCommandPalette;
$("commandModal").onclick=e=>{if(e.target===$("commandModal"))closeCommandPalette()};
$("commandSearch").oninput=()=>{commandIndex=0;renderCommandResults()};
$("commandSearch").onkeydown=e=>{
  if(e.key==="ArrowDown"){e.preventDefault();if(commandMatches.length){commandIndex=(commandIndex+1)%commandMatches.length;renderCommandResults()}}
  if(e.key==="ArrowUp"){e.preventDefault();if(commandMatches.length){commandIndex=(commandIndex-1+commandMatches.length)%commandMatches.length;renderCommandResults()}}
  if(e.key==="Enter"&&commandMatches[commandIndex]){e.preventDefault();runCommand(commandMatches[commandIndex].id)}
};
$("commandResults").onclick=e=>{const item=e.target.closest("[data-command]");if(item)runCommand(item.dataset.command)};

function toggleProfileMenu(force){
  const shouldOpen=force===undefined?$("profileMenu").classList.contains("hidden"):!!force;
  $("profileMenu").classList.toggle("hidden",!shouldOpen);
  $("profileButton").setAttribute("aria-expanded",String(shouldOpen));
}
$("profileButton").onclick=e=>{e.stopPropagation();toggleProfileMenu()};
$("profileButton").onkeydown=e=>{if(e.key==="ArrowDown"){e.preventDefault();toggleProfileMenu(true);$("profileMenu").querySelector("[role='menuitem']")?.focus()}};
document.addEventListener("click",e=>{if(!e.target.closest(".profile-area"))toggleProfileMenu(false)});

const preferenceKey="openwifi_ui_preferences_v1";
function readPreferences(){try{return JSON.parse(localStorage.getItem(preferenceKey)||"{}")||{}}catch{return{}}}
function applyPreferences(preferences=readPreferences()){
  const contrast=!!preferences.contrast,largeText=!!preferences.largeText,motion=!!preferences.reduceMotion;
  document.body.classList.toggle("high-contrast",contrast);
  document.body.classList.toggle("large-text",largeText);
  document.body.classList.toggle("reduce-motion",motion);
  $("prefContrast").checked=contrast;
  $("prefLargeText").checked=largeText;
  $("prefMotion").checked=motion;
}
function savePreferences(){const preferences={contrast:$("prefContrast").checked,largeText:$("prefLargeText").checked,reduceMotion:$("prefMotion").checked};localStorage.setItem(preferenceKey,JSON.stringify(preferences));applyPreferences(preferences)}
function openAccessibility(){const focusOrigin=document.activeElement;accessibilityFocusBefore=$("profileMenu").contains(focusOrigin)?$("profileButton"):focusOrigin;toggleProfileMenu(false);$("accessibilityModal").classList.remove("hidden");requestAnimationFrame(()=>$("prefContrast").focus())}
function closeAccessibility(){$("accessibilityModal").classList.add("hidden");if(accessibilityFocusBefore&&typeof accessibilityFocusBefore.focus==="function")accessibilityFocusBefore.focus();accessibilityFocusBefore=null}
$("accessibilityOpenRail").onclick=openAccessibility;
$("accessibilityOpenMenu").onclick=openAccessibility;
$("accessibilityClose").onclick=closeAccessibility;
$("accessibilityModal").onclick=e=>{if(e.target===$("accessibilityModal"))closeAccessibility()};
[$("prefContrast"),$("prefLargeText"),$("prefMotion")].forEach(input=>input.onchange=savePreferences);
applyPreferences();

function trapDialogFocus(event,dialog){
  if(event.key!=="Tab")return;
  const focusable=[...dialog.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex='-1'])")].filter(el=>el.getClientRects().length>0&&!el.closest('[inert],[aria-hidden="true"]'));
  if(focusable.length&&!dialog.contains(document.activeElement)){event.preventDefault();focusable[0].focus();return}
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();if($("commandModal").classList.contains("hidden"))openCommandPalette();else closeCommandPalette();return}
  const dialog=!$("commandModal").classList.contains("hidden")?$("commandModal"):!$("accessibilityModal").classList.contains("hidden")?$("accessibilityModal"):!$("confirmModal").classList.contains("hidden")?$("confirmModal"):!$("userModal").classList.contains("hidden")?$("userModal"):null;
  if(e.key==="Tab"&&dialog)trapDialogFocus(e,dialog);
  else if(e.key==="Tab"&&window.innerWidth<=1120&&$("contextPanel").classList.contains("open"))trapDialogFocus(e,$("contextPanel"));
  if(e.key!=="Escape")return;
  if(!$("commandModal").classList.contains("hidden"))closeCommandPalette();
  else if(!$("accessibilityModal").classList.contains("hidden"))closeAccessibility();
  else if(!$("confirmModal").classList.contains("hidden"))closeAsk(false);
  else if(!$("userModal").classList.contains("hidden"))closeUserModal();
  else if($("contextPanel").classList.contains("open"))closeContextPanel();
  else if(!$("profileMenu").classList.contains("hidden")){toggleProfileMenu(false);$("profileButton").focus()}
});
function currentTab(){return document.querySelector("[data-tab].active")?.dataset.tab||$("mobileNav").value||"platform"}function stampUpdated(){$("lastUpdated").textContent="Atualizado "+new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
function drawChart(id,rows,key,fmt){const box=$(id);if(!rows?.length){box.innerHTML="<div class='muted'>Sem dados ainda.</div>";return}const max=Math.max(...rows.map(r=>Number(r[key]||0)),1);box.innerHTML=rows.map(r=>{const v=Number(r[key]||0),h=Math.max(2,Math.round(v/max*140));return"<div class='barwrap'><div class='barvalue'>"+esc(fmt(v))+"</div><div class='bar' style='height:"+h+"px'></div><div class='barlabel'>"+esc(r.hour)+"</div></div>"}).join("")}
async function loadPlatform(quiet=false){return runLoad("platform",fetchPlatform,quiet)}
async function fetchPlatform(){
  platformState=await api("/api/admin/platform");
  const s=platformState.summary,siteRows=platformState.sites||[],current=siteRows.find(x=>x.id===platformState.currentSiteId);
  const now=new Date(platformState.generatedAt||Date.now());
  $("heroDate").textContent=now.toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"long"});
  $("heroSites").textContent=num(s.sites);$("heroRouters").textContent=num(s.routersOnline);$("heroVisitors").textContent=num(s.visitors);
  const offline=Number(s.routersOffline||0),disabled=Number(s.routersDisabled||0);
  const status=!s.routers?"Sem roteadores":offline?"Há roteadores sem sinal":s.routersOnline?"Sinal recente recebido":"Integrações desativadas";
  $("networkCount").textContent=num(s.routersOnline)+" / "+num(s.routers);
  $("networkLabel").textContent=status;$("networkLabel").className="status "+(offline?"warn":s.routersOnline?"good":"");
  $("networkMeta").textContent="Limite de contato: "+num(Math.round(platformState.offlineAfterMs/1000))+" s. "+num(offline)+" offline • "+num(disabled)+" desativados.";
  $("platformMetrics").innerHTML=[
    platformMetric("Receita bruta hoje",brl(s.grossCents),"money","Pagamentos aprovados no dia"),
    platformMetric("Após taxas registradas",brl(s.netCents),"money","Não representa repasse confirmado"),
    platformMetric("Vendas hoje",num(s.sales),"sales","Cobranças aprovadas no dia"),
    platformMetric("Visitantes hoje",num(s.visitors),"users","Dispositivos únicos no portal"),
    platformMetric("Acessos válidos",num(s.activeGrants),"wifi","Permissões vigentes, não sessões online"),
    platformMetric("Pix pendentes",num(s.pendingPayments),"clock","Cobranças ainda sem aprovação",s.pendingPayments?"warn":"")
  ].join("");
  const services=platformState.services||{};
  const integrationMissing=[!services.r2&&"Mídia R2",!services.mercadoPago&&"Mercado Pago",!services.webhook&&"Assinatura de webhook"].filter(Boolean);
  const attention=[];
  if(integrationMissing.length)attention.push(attentionItem("!","Configuração incompleta",integrationMissing.join(", "),"diagnostics","warn"));
  if(!s.routers)attention.push(attentionItem("+","Cadastre seu primeiro roteador","Escolha o modo e acompanhe a instalação.","routers","warn"));
  if(offline)attention.push(attentionItem("!",num(offline)+" roteador(es) sem sinal recente","Verifique o último contato e o estado de instalação.","routers","danger"));
  if(siteRows.some(x=>!x.salesEnabled))attention.push(attentionItem("Ⅱ","Vendas pausadas","Acessos já concedidos mantêm sua validade.","mode","warn"));
  if(s.pendingPayments)attention.push(attentionItem("$",num(s.pendingPayments)+" Pix pendente(s)","Pendência não significa falha. Consulte os pagamentos recentes.","dash","warn"));
  const count=attention.length;
  if(!count)attention.push(attentionItem("✓","Sem pendências nos dados consultados","Confira o diagnóstico para verificar as integrações.","diagnostics","good"));
  $("attentionList").innerHTML=attention.join("");$("attentionCount").textContent=count?String(count):"OK";$("attentionCount").classList.toggle("clear",!count);
  $("topAttentionCount").textContent=String(count);$("topAttention").classList.toggle("has-items",!!count);$("topAttention").setAttribute("aria-label","Ver "+count+" prioridade"+(count===1?"":"s")+" da operação");
  $("navHealthDot").className="system-dot "+(offline?"bad":count?"warn":"");$("navHealthLabel").textContent=num(s.routersOnline)+" roteador(es) com sinal";$("navHealthMeta").textContent=count?count+" itens para acompanhar":"Dados consultados sem pendências";
  $("platformStatus").textContent=status;$("platformStatus").className="status "+(offline?"warn":s.routersOnline?"good":"");
  const contextName=current?.name||state?.site?.name||platformState.currentSiteId;
  $("currentSiteSummary").textContent=contextName;$("workspaceName").textContent=contextName;$("workspaceMeta").textContent="Estabelecimento atual • troca indisponível";
  $("siteContext").replaceChildren(new Option(contextName,platformState.currentSiteId));
  $("siteCards").innerHTML=siteRows.map(site=>"<article class='site-card current'><div class='site-head'><div><div class='site-title'>"+esc(site.name)+"</div><div class='site-id'>"+esc(site.id)+" • estabelecimento atual</div></div><span class='status "+(site.routerOnline?"good":"warn")+"'>"+(site.routerOnline?"Sinal recente":"Sem sinal recente")+"</span></div><div class='site-stats'>"+[["Visitantes hoje",num(site.visitorsToday)],["Vendas hoje",num(site.paidToday)],["Bruto hoje",brl(site.revenueTodayCents)],["Acessos válidos",num(site.activeGrants)],["Pix pendentes",num(site.pendingPayments)],["Modo",site.mode==="party"?"Party":"Padrão"]].map(x=>"<div class='site-stat'><span>"+esc(x[0])+"</span><b>"+esc(x[1])+"</b></div>").join("")+"</div><p class='muted'>"+num(site.routerOnline)+" / "+num(site.routerTotal)+" roteadores com sinal • "+num(site.routerDisabled)+" desativados"+(site.routerLegacy?" • integração legada":"")+"<br>Último contato: "+dt(site.lastSeenAt)+". Hosts reportados: "+num(site.routerHostCount)+" (não equivale a sessões conectadas).</p><div class='actions'><button class='btn primary' data-jump='dash'>Abrir operação</button><button class='btn' data-jump='routers'>Ver roteadores</button></div></article>").join("")||"<p class='empty-row'>Nenhum estabelecimento retornado. Confira a configuração do local antes de operar.</p>";
  $("serviceStrip").innerHTML=[["Worker","Resposta recebida",true],["D1","Consulta realizada",true],["Mídia R2",services.r2?"Configurado; não verificado":"Não configurado",!!services.r2],["Mercado Pago",services.mercadoPago?"Configurado; não verificado":"Não configurado",!!services.mercadoPago],["Webhook MP",services.webhook?"Assinatura configurada":"Assinatura não configurada",!!services.webhook]].map(x=>"<span class='service-pill'><i style='background:"+(x[2]?"var(--accent)":"var(--warning)")+"'></i>"+esc(x[0])+": "+esc(x[1])+"</span>").join("");
}

let panelRefresh=null;
async function loadDashboard(fill=false,quiet=false){return runLoad("dash",async()=>{const initial=!state;state=await api("/api/admin/dashboard");renderDash(fill||initial);applyRoleUI()},quiet)}
function loadCurrentPage(id=currentTab(),quiet=false){const loaders={platform:()=>loadPlatform(quiet),hotspots:()=>runLoad("hotspots",async()=>{if(!await loadPlatform(quiet))throw new Error("Não foi possível consultar o estabelecimento.")},quiet),dash:()=>loadDashboard(false,quiet),routers:loadRouters,plans:loadPlans,users:loadUsers,codes:loadCodes,groups:loadGroups,reports:async()=>{if(await loadEvents()===false)return false;return loadReport()},diagnostics:loadDiagnostics,team:loadAccounts,audit:loadAudit,mode:()=>loadDashboard(false,quiet),portal:()=>loadDashboard(false,quiet)};return loaders[id]?loaders[id]():Promise.resolve(true)}
async function refreshPanel(manual=true){
  if(panelRefresh)return panelRefresh;
  const b=$("refreshPanel");b.disabled=true;b.classList.add("loading");b.setAttribute("aria-busy","true");
  panelRefresh=(async()=>{const id=currentTab(),ok=await loadCurrentPage(id,!manual);if(ok){stampUpdated();if(manual)toast("Painel atualizado","Dados da página carregados.")}else if(manual)toast("Não foi possível atualizar","Use Tentar novamente na página.","error");return ok})();
  try{return await panelRefresh}finally{panelRefresh=null;b.disabled=false;b.classList.remove("loading");b.removeAttribute("aria-busy")}
}
$("refreshPanel").onclick=()=>refreshPanel(true);
async function boot(){
  try{me=(await api("/api/admin/me")).user}catch(e){$("loginBox").classList.remove("hidden");$("app").classList.add("hidden");if(e.status!==401)$("loginErr").textContent="Não foi possível verificar sua sessão. Tente novamente.";return}
  $("loginBox").classList.add("hidden");$("app").classList.remove("hidden");applyRoleUI();
  const results=await Promise.all([loadDashboard(true),loadPlatform()]);
  if(results.every(Boolean))stampUpdated();
}
$("login").onclick=async()=>{try{await api("/api/admin/login",{method:"POST",body:JSON.stringify({user:$("user").value,password:$("pass").value})});$("loginErr").textContent="";toast("Login efetuado");await boot()}catch{$("loginErr").textContent="Usuário ou senha inválidos."}};
$("pass").onkeydown=e=>{if(e.key==="Enter")$("login").click()};
$("user").onkeydown=e=>{if(e.key==="Enter")$("pass").focus()};
async function logout(){await api("/api/admin/logout",{method:"POST"});location.reload()}$("logoutSide").onclick=logout;

function renderPayments(){
  const all=state?.recentPayments||[];
  const query=norm($("paymentSearch").value);
  const status=$("paymentStatus").value;
  const rows=all.filter(p=>{
    const info=paymentInfo(p.status);
    const matchesText=!query||norm([p.plan_name,p.payer_email,p.phone_e164,p.status,info.label].join(" ")).includes(query);
    const matchesStatus=status==="all"||(status==="failed"?info.problem:info.key===status);
    return matchesText&&matchesStatus;
  });
  $("paymentsCount").textContent=num(rows.length)+" de "+num(all.length);
  $("payments").innerHTML=rows.map(p=>{
    const info=paymentInfo(p.status);
    return "<tr><td><b>"+esc(p.plan_name||"Plano")+"</b></td><td><span class='payment-status "+esc(info.key)+"'>"+esc(info.label)+"</span></td><td>"+brl(p.amount_cents)+"</td><td>"+esc(p.payer_email||"—")+"</td><td>"+esc(p.phone_e164||"—")+"</td><td>"+dt(p.created_at)+"</td></tr>";
  }).join("")||"<tr><td class='empty-row' colspan='6'>Nenhum pagamento corresponde aos filtros.</td></tr>";
}
$("paymentSearch").oninput=renderPayments;
$("paymentStatus").onchange=renderPayments;

function renderDash(fill=true){
  const m=state.metrics||{};
  const site=state.site||{};
  const enabled=!!site.sales_enabled;
  const mode=site.mode==="party"?"Party":"Padrão";
  const revenueTrend=trendInfo(m.revenueTrendPct);
  const salesTrend=trendInfo(m.salesTrendPct);
  $("localTitle").textContent=site.name||site.portal_title||"Operação do local";
  $("localContext").textContent="Indicadores de hoje • "+new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"});
  $("modeBadge").textContent="MODO "+mode.toUpperCase();
  $("modeBadge").className="status good";
  $("salesBadge").textContent=enabled?"VENDAS ATIVAS":"VENDAS PAUSADAS";
  $("salesBadge").className="status "+(enabled?"good":"warn");
  $("metrics").innerHTML=[
    dashboardMetric("Último sinal do local",m.routerOnline?"RECENTE":"SEM SINAL",m.routerOnline?"Último contato dentro do limite":"Confira os roteadores",m.routerOnline?"good":"warn"),
    dashboardMetric("Hosts no último contato",num(m.routerHostCount),"Não equivale a sessões conectadas",""),
    dashboardMetric("Visitantes hoje",num(m.visitorsToday),"Vendas / visitantes: "+pct(m.conversionPct),m.visitorsToday?"good":""),
    dashboardMetric("Vendas hoje",num(m.paidToday),salesTrend.text,salesTrend.tone),
    dashboardMetric("Receita bruta",brl(m.revenueTodayCents),revenueTrend.text,revenueTrend.tone),
    dashboardMetric("Após taxas registradas",brl(m.netTodayCents),brl(m.feesTodayCents)+" em taxas",m.netTodayCents?"good":""),
    dashboardMetric("Acessos ativos",num(m.activeGrants),num(m.activeAttempts)+" tentativa"+(Number(m.activeAttempts)===1?" ativa":"s ativas"),m.activeGrants?"good":""),
    dashboardMetric("Pix pendentes",num(m.pendingPayments),num(m.failedPaymentsToday)+" com problema hoje",m.pendingPayments||m.failedPaymentsToday?"warn":"good")
  ].join("");
  $("avgTicket").textContent=brl(m.averageTicketCents);
  $("conversionRate").textContent=pct(m.conversionPct);
  $("approvalRate").textContent=pct(m.approvalPct);
  $("netMargin").textContent=pct(m.netMarginPct);
  $("revenueTrend").textContent=revenueTrend.text;
  $("revenueTrend").className="trend "+revenueTrend.tone;
  $("salesTrend").textContent=salesTrend.text;
  $("salesTrend").className="trend "+salesTrend.tone;
  $("paymentFlowMeta").textContent=num(m.paymentStartsToday)+" iniciados • "+num(m.failedPaymentsToday)+" com problema";
  renderPayments();
  drawChart("salesChart",state.hourly,"sales",v=>String(v));
  drawChart("revenueChart",state.hourly,"revenueCents",brl);
  $("salesStateText").textContent=enabled?"Novas vendas estão ativas.":"NOVAS VENDAS PAUSADAS — acessos existentes continuam.";
  $("emergencyBtn").textContent=enabled?"Pausar novas vendas":"Retomar novas vendas";
  $("emergencyBtn").className="btn "+(enabled?"warning":"primary")+(can("operator")?"":" hidden");
  if(fill){
    $("modeSel").value=site.mode;
    $("sales").value=enabled?"1":"0";
    $("portalTitle").value=site.portal_title||"";
    $("portalSubtitle").value=site.portal_subtitle||"";
    $("supportWhatsapp").value=site.support_whatsapp||"";
    $("aboutTitle").value=site.about_title||"";
    $("aboutText").value=site.about_text||"";
    $("bgMode").value=site.background_mode||"gradient";
    $("bgUrl").value=String(site.background_image_url||"").startsWith("r2://")?"":(site.background_image_url||"");
    $("logoUrl").value=String(site.logo_image_url||"").startsWith("r2://")?"":(site.logo_image_url||"");
    $("requireWhatsappStandard").checked=!!site.require_whatsapp_standard;
    $("noticeEnabled").checked=!!site.notice_enabled;
    $("noticeTitle").value=site.notice_title||"";
    $("noticeText").value=site.notice_text||"";
    $("noticeStart").value=localInput(site.notice_starts_at);
    $("noticeEnd").value=localInput(site.notice_ends_at);
    $("emergencyMessage").value=site.emergency_message||"";
    $("privacyTitle").value=site.privacy_title||"";
    $("privacyText").value=site.privacy_text||"";
    $("privacyRequire").checked=!!site.privacy_require_accept;
    const v=Date.now();
    $("logoPreview").src="/assets/site-logo?site=openwifi-main&v="+v;
    $("backgroundPreview").src="/assets/site-background?site=openwifi-main&v="+v;
    document.querySelectorAll(".brandLogo").forEach(i=>i.src="/assets/site-logo?site=openwifi-main&v="+v);
    if(state.event){$("eventName").value=state.event.name||"";$("eventStart").value=localInput(state.event.starts_at);$("eventEnd").value=localInput(state.event.ends_at)}
  }
}
$("emergencyBtn").onclick=async()=>{if(!can("operator"))return;const enabled=!!state.site.sales_enabled,ok=await ask(enabled?"Pausar novas vendas?":"Retomar novas vendas?",enabled?"Novas compras serão impedidas; acessos existentes continuam.":"Novas compras voltarão a ser aceitas.",enabled?"Pausar":"Retomar",enabled);if(!ok)return;try{await api("/api/admin/emergency",{method:"POST",body:JSON.stringify({salesEnabled:!enabled,message:$("emergencyMessage").value})});toast(enabled?"Vendas pausadas":"Vendas retomadas");await refreshPanel(false)}catch(e){toast("Erro",e.message,"error")}};
async function saveConfig(src){const ok=await ask("Salvar alterações?","As novas configurações serão aplicadas.","Salvar");if(!ok)return;try{await api("/api/admin/config",{method:"PUT",body:JSON.stringify({mode:$("modeSel").value,salesEnabled:$("sales").value==="1",backgroundMode:$("bgMode").value,backgroundImageUrl:$("bgUrl").value,supportWhatsapp:$("supportWhatsapp").value,requireWhatsappStandard:$("requireWhatsappStandard").checked,portalTitle:$("portalTitle").value,portalSubtitle:$("portalSubtitle").value,aboutTitle:$("aboutTitle").value,aboutText:$("aboutText").value,logoImageUrl:$("logoUrl").value,noticeEnabled:$("noticeEnabled").checked,noticeTitle:$("noticeTitle").value,noticeText:$("noticeText").value,noticeStartsAt:toMs($("noticeStart").value),noticeEndsAt:toMs($("noticeEnd").value),emergencyMessage:$("emergencyMessage").value,privacyTitle:$("privacyTitle").value,privacyText:$("privacyText").value,privacyRequireAccept:$("privacyRequire").checked})});toast("Configurações salvas",src==="portal"?"Captive portal atualizado.":"Modo atualizado.");await boot()}catch(e){toast("Erro ao salvar",e.message,"error")}}$("saveMode").onclick=()=>saveConfig("mode");$("savePortal").onclick=()=>saveConfig("portal");$("saveEvent").onclick=async()=>{const ok=await ask("Salvar evento?","Nome e horários serão atualizados.","Salvar evento");if(!ok)return;try{await api("/api/admin/event",{method:"PUT",body:JSON.stringify({name:$("eventName").value,startsAt:toMs($("eventStart").value),endsAt:toMs($("eventEnd").value)})});toast("Evento atualizado");await boot()}catch(e){toast("Erro no evento",e.message,"error")}};
async function uploadMedia(k){const input=$(k==="logo"?"logoFile":"backgroundFile"),file=input.files?.[0];if(!file){toast("Selecione uma imagem","","warn");return}const fd=new FormData();fd.append("file",file);try{await api("/api/admin/media/"+k,{method:"POST",body:fd});toast("Imagem enviada");input.value="";state=await api("/api/admin/dashboard");renderDash(true)}catch(e){toast("Falha no upload",e.message,"error")}}async function deleteMedia(k){const ok=await ask("Remover imagem?",k==="logo"?"A logo padrão voltará a ser usada.":"O fundo voltará ao gradiente.","Remover",true);if(!ok)return;try{await api("/api/admin/media/"+k,{method:"DELETE"});toast("Imagem removida");state=await api("/api/admin/dashboard");renderDash(true)}catch(e){toast("Erro",e.message,"error")}}$("uploadLogo").onclick=()=>uploadMedia("logo");$("uploadBackground").onclick=()=>uploadMedia("background");$("deleteLogo").onclick=()=>deleteMedia("logo");$("deleteBackground").onclick=()=>deleteMedia("background");

function syncRouterInstallFields(){
  const mode=$("routerInstallMode").value;
  $("routerFullFields").classList.toggle("hidden",mode!=="full");
  $("routerHotspotFields").classList.toggle("hidden",mode!=="hotspot");
  $("routerAgentInfo").classList.toggle("hidden",mode!=="agent");
  $("routerWan").closest("div").classList.toggle("hidden",mode!=="full");
}
$("routerInstallMode").onchange=syncRouterInstallFields;
syncRouterInstallFields();

function routerStatusBadge(r){
  if(r.install_status==="revoking")return "<span class='status warn'>DESATIVANDO</span>";
  if(r.install_status==="deprovisioned")return "<span class='status bad'>DESATIVADA</span>";
  if(r.online&&r.enabled)return "<span class='status good'>ONLINE</span>";
  
  
  if(!r.enabled)return "<span class='status bad'>DESATIVADA</span>";
  return "<span class='status'>OFFLINE</span>";
}

function loadRouters(){return runLoad("routers",fetchRouters)}
async function fetchRouters(){const d=await api("/api/admin/routers");routers=d.routers||[];renderRouterRows()}
function renderRouterRows(){
  const online=routers.filter(r=>r.enabled&&r.online).length,disabled=routers.filter(r=>!r.enabled).length;
  $("routerMetrics").innerHTML=[["Cadastrados",routers.length],["Online",online],["Offline",routers.length-online-disabled],["Desativados",disabled]].map(x=>"<div class='insight'><span>"+x[0]+"</span><b>"+num(x[1])+"</b></div>").join("");
  const query=norm($("routerSearch").value),filter=$("routerStatusFilter").value;
  const visible=routers.filter(r=>(!query||norm([r.name,r.identity,r.board,r.id].join(" ")).includes(query))&&(filter==="all"||(filter==="online"?r.enabled&&r.online:filter==="disabled"?!r.enabled:r.enabled&&!r.online)));
    $("routersRows").innerHTML=visible.map(r=>{
      const equip=[r.board,r.version].filter(Boolean).map(esc).join("<br>")||"—";
      const install=esc(({installed:"Instalado",online:"Registrou contato",installing:"Instalando",enrolled:"Adotado",failed:"Falha na instalação",error:"Falha na instalação",revoking:"Desativação solicitada",deprovisioned:"Integração removida"})[r.install_status]||r.install_status||"Sem informação")+(r.install_step?"<br><span class='muted'>"+esc(r.install_step)+(r.install_message?" • "+esc(r.install_message):"")+"</span>":"");
      let actions="—";
      if(can("admin")){
        if(r.enabled)actions="<button class='btn danger' data-row-action='disable-router' data-row-value='"+esc(r.id)+"'>Desativar integração</button>";
        else if(r.install_status==="deprovisioned"||!r.last_seen_at)actions="<button class='btn ghost' data-row-action='delete-router' data-row-value='"+esc(r.id)+"'>Excluir do painel</button>";
        else actions="<span class='muted'>Aguardando a RB confirmar a limpeza...</span>";
      }
      return "<tr><td><b>"+esc(r.name)+"</b><br><span class='muted'>"+esc(r.identity||r.id.slice(0,8))+"</span></td><td>"+routerStatusBadge(r)+"</td><td>"+equip+"</td><td>"+esc(({full:"Completa",hotspot:"HotSpot existente",agent:"Somente agente"})[r.install_mode]||r.install_mode)+"</td><td>"+install+"</td><td>"+dt(r.last_seen_at)+"</td><td>"+esc(r.last_public_ip||"—")+"</td><td>"+actions+"</td></tr>";
    }).join("")||"<tr><td colspan='8' class='muted'>Nenhum roteador encontrado. Ajuste os filtros ou cadastre a primeira MikroTik.</td></tr>";
}
$("routerSearch").oninput=renderRouterRows;$("routerStatusFilter").onchange=renderRouterRows;
$("reloadRouters").onclick=async()=>{if(await loadRouters())toast("Roteadores atualizados")};

$("generateRouterScript").onclick=async()=>{
  if(!can("admin"))return;
  const mode=$("routerInstallMode").value;
  const hotspot=mode==="hotspot"?$("routerHotspotExisting").value:$("routerHotspot").value;
  const lanPorts=$("routerLanPorts").value.split(",").map(x=>x.trim()).filter(Boolean);
  try{
    const d=await api("/api/admin/routers/enrollment",{
      method:"POST",
      body:JSON.stringify({
        name:$("routerName").value,
        installMode:mode,
        wanInterface:$("routerWan").value,
        lanPorts,
        networkCidr:$("routerNetwork").value,
        gatewayIp:$("routerGateway").value,
        poolRange:$("routerPool").value,
        hotspotServer:hotspot
      })
    });
    lastRouterScript=d.bootstrapScript;
    $("routerBootstrapScript").value=d.bootstrapScript;
    $("routerScriptExpiry").textContent="Token de adoção válido até "+dt(d.expiresAt)+" e utilizável uma única vez.";
    $("routerScriptBox").classList.remove("hidden");
    toast("Script gerado","Cole o script na MikroTik antes de o token expirar.");
    await loadRouters();
    $("routerScriptBox").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){toast("Não foi possível gerar o script",e.message,"error")}
};

$("copyRouterScript").onclick=async()=>{
  if(!lastRouterScript)return;
  try{
    await navigator.clipboard.writeText(lastRouterScript);
    toast("Script copiado","Agora cole no Terminal da MikroTik.");
  }catch{
    $("routerBootstrapScript").focus();
    $("routerBootstrapScript").select();
    toast("Selecione e copie o script manualmente","","warn");
  }
};

window.disableRouter=async id=>{
  const ok=await ask(
    "Desativar integração com esta MikroTik?",
    "No próximo poll a RB removerá os bypasses e queues criados pelo Open Wi-Fi, derrubará as sessões Cloud e pausará o agente. A configuração física de bridge/DHCP/NAT não será apagada automaticamente.",
    "Desativar integração",
    true
  );
  if(!ok)return;
  try{
    await api("/api/admin/routers/"+id+"/disable",{method:"POST",body:"{}"});
    toast("Desativação solicitada","Aguardando o próximo poll da MikroTik.");
    await loadRouters()
  }catch(e){toast("Erro",e.message,"error")}
};

window.deleteRouter=async id=>{
  const ok=await ask("Excluir MikroTik do painel?","Remove o cadastro do Open Wi-Fi. Isso não executa uma desinstalação na RB.","Excluir",true);
  if(!ok)return;
  try{
    await api("/api/admin/routers/"+id,{method:"DELETE"});
    toast("MikroTik removida do painel");
    await loadRouters()
  }catch(e){
    toast(
      "Ainda não é seguro excluir",
      e.message==="router_must_be_deprovisioned_first"
        ?"Primeiro desative a integração e aguarde a RB confirmar a limpeza."
        :e.message,
      "error"
    )
  }
};

function loadPlans(){return runLoad("plans",fetchPlans)}
async function fetchPlans(){const d=await api("/api/admin/plans");plans=d.plans;$("plansRows").innerHTML=plans.map(p=>{const a=can("admin")?"<button class='btn' data-row-action='edit-plan' data-row-value='"+esc(p.id)+"'>Editar</button> <button class='btn danger' data-row-action='delete-plan' data-row-value='"+esc(p.id)+"'>Excluir</button>":"—";return"<tr><td><b>"+esc(p.name)+"</b></td><td>"+esc(p.mode)+"</td><td>"+brl(p.price_cents)+"</td><td>"+(p.party_until_event_end?"Fim do evento":durationLabel(p.duration_seconds,false))+"</td><td>"+p.max_devices+"</td><td>"+speedLabel(p.rate_limit_down_kbps,p.rate_limit_up_kbps)+"</td><td><span class='status "+(p.enabled?"ok":"bad")+"'>"+(p.enabled?"ATIVO":"INATIVO")+"</span></td><td>"+a+"</td></tr>"}).join("")}window.editPlan=id=>{if(!can("admin"))return;const p=plans.find(x=>x.id===id);if(!p)return;$("planForm").classList.remove("hidden");$("planId").value=p.id;$("planName").value=p.name;$("planSlug").value=p.slug;$("planMode").value=p.mode;$("planPrice").value=(p.price_cents/100).toFixed(2);$("planMinutes").value=p.duration_seconds?Math.round(p.duration_seconds/60):60;$("planMax").value=p.max_devices;$("planSort").value=p.sort_order||0;$("planDown").value=Math.round(Number(p.rate_limit_down_kbps||0)/1000);$("planUp").value=Math.round(Number(p.rate_limit_up_kbps||0)/1000);$("planEventEnd").checked=!!p.party_until_event_end;$("planEnabled").checked=!!p.enabled};$("newPlan").onclick=()=>{if(!can("admin"))return;$("planForm").classList.remove("hidden");$("planId").value="";$("planName").value="";$("planSlug").value="";$("planMode").value="standard";$("planPrice").value="2.00";$("planMinutes").value="60";$("planMax").value="1";$("planSort").value="0";$("planDown").value="0";$("planUp").value="0";$("planEventEnd").checked=false;$("planEnabled").checked=true};$("cancelPlan").onclick=()=>$("planForm").classList.add("hidden");$("savePlan").onclick=async()=>{const id=$("planId").value,ok=await ask(id?"Salvar produto?":"Criar produto?","Preço, duração e velocidade serão aplicados.",id?"Salvar":"Criar");if(!ok)return;try{await api("/api/admin/plans"+(id?"/"+id:""),{method:id?"PUT":"POST",body:JSON.stringify({name:$("planName").value,slug:$("planSlug").value,mode:$("planMode").value,priceCents:Math.round(Number($("planPrice").value)*100),durationSeconds:Number($("planMinutes").value)*60,maxDevices:Number($("planMax").value),sortOrder:Number($("planSort").value),partyUntilEventEnd:$("planEventEnd").checked,enabled:$("planEnabled").checked,rateDownKbps:Math.round(Number($("planDown").value||0)*1000),rateUpKbps:Math.round(Number($("planUp").value||0)*1000)})});$("planForm").classList.add("hidden");toast("Produto salvo");await loadPlans()}catch(e){toast("Erro no produto",e.message,"error")}};window.delPlan=async id=>{const ok=await ask("Excluir produto?","Se houver venda, ele será desativado.","Excluir",true);if(!ok)return;try{await api("/api/admin/plans/"+id,{method:"DELETE"});toast("Produto atualizado");await loadPlans()}catch(e){toast("Erro",e.message,"error")}};
// Values from API records stay in HTML-escaped data attributes, never executable markup.
const rowActionHandlers={
  "disable-router":{role:"admin",run:value=>window.disableRouter(value)},
  "delete-router":{role:"admin",run:value=>window.deleteRouter(value)},
  "edit-plan":{role:"admin",run:value=>window.editPlan(value)},
  "delete-plan":{role:"admin",run:value=>window.delPlan(value)},
  "revoke-user":{role:"operator",run:value=>window.revokeOneUser(value)},
  "open-user":{role:"viewer",run:value=>window.openUser(value)},
  "copy-group-link":{role:"viewer",run:value=>window.copyGroupLink(value)},
  "edit-account":{role:"admin",run:value=>window.editAccount(value)},
  "delete-account":{role:"admin",run:value=>window.deleteAccount(value)}
};
document.addEventListener("click",event=>{
  const button=event.target.closest("button[data-row-action]");
  if(!button||button.disabled)return;
  const action=rowActionHandlers[button.dataset.rowAction];
  if(!action||!can(action.role))return;
  Promise.resolve().then(()=>action.run(button.dataset.rowValue||"")).catch(error=>toast("Não foi possível concluir a ação",error.message,"error"));
});
function selectedUserIds(){return[...selectedUsers]}
function updateSelectionCount(){
  const n=selectedUsers.size;
  const visible=[...document.querySelectorAll(".userSelect")];
  const checked=visible.filter(x=>selectedUsers.has(x.value)).length;
  $("selectionCount").textContent=num(n)+" selecionado"+(n===1?"":"s");
  $("selectAllUsers").checked=visible.length>0&&checked===visible.length;
  $("selectAllUsers").indeterminate=checked>0&&checked<visible.length;
}
function renderUsers(){
  const query=norm($("userSearch").value);
  const status=$("userStatusFilter").value;
  const now=Date.now();
  const users=adminUsers.filter(u=>{
    const active=Number(u.active_until||0)>now;
    const matchesStatus=status==="all"||(status==="active"?active:!active);
    const matchesText=!query||norm([u.hostname,u.payer_email,u.phone_e164,u.id,...(u.macs||[])].join(" ")).includes(query);
    return matchesStatus&&matchesText;
  }).sort((a,b)=>(Number(b.active_until||0)>now)-(Number(a.active_until||0)>now)||Number(b.last_seen_at||0)-Number(a.last_seen_at||0));
  $("usersCount").textContent=num(users.length)+" de "+num(adminUsers.length);
  $("usersRows").innerHTML=users.map(u=>{
    const who=u.hostname||u.payer_email||u.phone_e164||String(u.id).slice(0,8);
    const active=Number(u.active_until||0)>now;
    const macs=(u.macs||[]).map(esc).join("<br>")||"—";
    const revoke=active&&can("operator")?" <button class='btn danger' data-row-action='revoke-user' data-row-value='"+esc(u.id)+"'>Encerrar</button>":"";
    return "<tr><td><input class='userSelect' type='checkbox' style='width:auto' value='"+esc(u.id)+"' "+(selectedUsers.has(u.id)?"checked":"")+" aria-label='Selecionar "+esc(who)+"'></td><td><b>"+esc(who)+"</b><br><span class='muted'>"+esc([u.payer_email,u.phone_e164].filter(Boolean).join(" • ")||"Sem contato informado")+"</span></td><td>"+macs+"</td><td>"+dt(u.last_seen_at)+"</td><td>"+(active?"até "+dt(u.active_until):"nenhum")+"</td><td><span class='status "+(active?"good":"")+"'>"+(active?"COM ACESSO":"SEM ACESSO")+"</span></td><td><button class='btn' data-row-action='open-user' data-row-value='"+esc(u.id)+"'>Detalhes</button>"+revoke+"</td></tr>";
  }).join("")||"<tr><td class='empty-row' colspan='7'>Nenhum usuário corresponde aos filtros.</td></tr>";
  document.querySelectorAll(".userSelect").forEach(x=>x.onchange=()=>{if(x.checked)selectedUsers.add(x.value);else selectedUsers.delete(x.value);updateSelectionCount()});
  updateSelectionCount();
}
function loadUsers(){return runLoad("users",fetchUsers)}
async function fetchUsers(){
  const d=await api("/api/admin/users");
  adminUsers=d.users||[];
  const valid=new Set(adminUsers.map(u=>u.id));
  [...selectedUsers].forEach(id=>{if(!valid.has(id))selectedUsers.delete(id)});
  renderUsers();
}
$("userSearch").oninput=renderUsers;
$("userStatusFilter").onchange=renderUsers;
$("reloadUsers").onclick=async()=>{try{if(await loadUsers())toast("Lista atualizada")}catch(e){toast("Falha ao atualizar usuários",e.message,"error")}};
$("selectAllUsers").onchange=()=>{
  document.querySelectorAll(".userSelect").forEach(x=>{x.checked=$("selectAllUsers").checked;if(x.checked)selectedUsers.add(x.value);else selectedUsers.delete(x.value)});
  updateSelectionCount();
};
async function revokeUsers(ids){
  if(!can("operator"))return;
  if(!ids.length){toast("Nenhum usuário selecionado","","warn");return}
  const ok=await ask("Encerrar acesso?","Para voltar, será necessária nova compra ou novo código.","Encerrar",true);
  if(!ok)return;
  try{
    const d=await api("/api/admin/users/revoke",{method:"POST",body:JSON.stringify({deviceIds:ids,reason:$("revokeReason").value})});
    ids.forEach(id=>selectedUsers.delete(id));
    toast("Acesso encerrado",num(d.grantsRevoked)+" acesso"+(Number(d.grantsRevoked)===1?" revogado.":"s revogados."));
    await loadUsers();
    closeUserModal();
  }catch(e){toast("Erro",e.message,"error")}
}
window.revokeOneUser=id=>revokeUsers([id]);
$("revokeSelected").onclick=()=>revokeUsers(selectedUserIds());

function closeUserModal(){
  $("userModal").classList.add("hidden");
  if(userFocusBeforeDialog&&typeof userFocusBeforeDialog.focus==="function")userFocusBeforeDialog.focus();
  userFocusBeforeDialog=null;
}
window.openUser=async id=>{currentUserId=id;try{const d=await api("/api/admin/users/"+encodeURIComponent(id)),u=d.user,active=d.grants.find(g=>g.status==="active"&&Number(g.ends_at)>Date.now());$("userModalTitle").textContent=u.hostname||u.payer_email||u.phone_e164||"Usuário";$("userModalSub").textContent=(u.payer_email||"")+" • "+(u.phone_e164||"");$("userSummary").innerHTML=[["Criado",dt(u.created_at)],["Último contato",d.macs.length?dt(d.macs[0].last_seen_at):"—"],["Acesso atual",active?dt(active.ends_at):"Nenhum"]].map(x=>"<div class='mini'><span>"+x[0]+"</span><b>"+esc(x[1])+"</b></div>").join("");$("userMacs").innerHTML="<table><thead><tr><th>MAC</th><th>IP</th><th>Último contato</th></tr></thead><tbody>"+d.macs.map(x=>"<tr><td>"+esc(x.mac)+"</td><td>"+esc(x.ip||"—")+"</td><td>"+dt(x.last_seen_at)+"</td></tr>").join("")+"</tbody></table>";$("userPayments").innerHTML="<table><thead><tr><th>Plano</th><th>Status</th><th>Valor</th><th>Data</th></tr></thead><tbody>"+d.payments.map(x=>{const p=paymentInfo(x.status);return"<tr><td>"+esc(x.plan_name)+"</td><td><span class='payment-status "+esc(p.key)+"'>"+esc(p.label)+"</span></td><td>"+brl(x.amount_cents)+"</td><td>"+dt(x.created_at)+"</td></tr>"}).join("")+"</tbody></table>";$("userGrants").innerHTML="<table><thead><tr><th>Origem</th><th>Descrição</th><th>Status</th><th>Início</th><th>Fim</th><th>Velocidade</th></tr></thead><tbody>"+d.grants.map(x=>"<tr><td>"+esc(x.grant_source||"legacy")+"</td><td>"+esc(x.grant_label||"—")+"</td><td>"+esc(x.status)+"</td><td>"+dt(x.starts_at)+"</td><td>"+dt(x.ends_at)+"</td><td>"+speedLabel(x.rate_limit_down_kbps,x.rate_limit_up_kbps)+"</td></tr>").join("")+"</tbody></table>";$("userAttempts").innerHTML="<table><thead><tr><th>#</th><th>MAC</th><th>Status</th><th>Início RB</th><th>Fim</th></tr></thead><tbody>"+d.attempts.map(x=>"<tr><td>"+x.attempt_number+"</td><td>"+esc(x.mac)+"</td><td>"+esc(x.status)+"</td><td>"+dt(x.router_started_at)+"</td><td>"+dt(x.ends_at)+"</td></tr>").join("")+"</tbody></table>";$("userActions").classList.toggle("hidden",!can("operator"));if($("userModal").classList.contains("hidden"))userFocusBeforeDialog=document.activeElement;$("userModal").classList.remove("hidden");$("courtesyForm").classList.add("hidden");requestAnimationFrame(()=>$("closeUserModal").focus())}catch(e){toast("Erro ao abrir usuário",e.message,"error")}};
$("closeUserModal").onclick=closeUserModal;
$("userModal").onclick=e=>{if(e.target===$("userModal"))closeUserModal()};
$("giveCourtesy").onclick=()=>$("courtesyForm").classList.remove("hidden");$("cancelCourtesy").onclick=()=>$("courtesyForm").classList.add("hidden");$("courtesyType").onchange=()=>$("courtesyMinutesWrap").classList.toggle("hidden",$("courtesyType").value!=="minutes");$("revokeFromDetail").onclick=()=>currentUserId&&revokeUsers([currentUserId]);$("saveCourtesy").onclick=async()=>{if(!currentUserId)return;const ok=await ask("Liberar cortesia?","O aparelho receberá acesso sem cobrança.","Liberar");if(!ok)return;try{const d=await api("/api/admin/users/"+encodeURIComponent(currentUserId)+"/courtesy",{method:"POST",body:JSON.stringify({type:$("courtesyType").value,minutes:Number($("courtesyMinutes").value),label:$("courtesyLabel").value,downKbps:Math.round(Number($("courtesyDown").value||0)*1000),upKbps:Math.round(Number($("courtesyUp").value||0)*1000)})});toast("Cortesia liberada","Válida até "+dt(d.endsAt));$("courtesyForm").classList.add("hidden");await openUser(currentUserId);await loadUsers()}catch(e){toast("Erro na cortesia",e.message,"error")}};
function loadCodes(){return runLoad("codes",fetchCodes)}
async function fetchCodes(){const d=await api("/api/admin/codes");$("codesRows").innerHTML=d.codes.map(c=>"<tr><td><b>"+esc(c.code)+"</b></td><td>"+esc(c.mode)+"</td><td>"+durationLabel(c.duration_seconds,!!c.is_permanent)+"</td><td><span class='status "+(c.status==="active"?"ok":"bad")+"'>"+esc(c.status.toUpperCase())+"</span></td><td>"+(c.redeemed_at?"Usado em "+dt(c.redeemed_at):"Não utilizado")+"</td></tr>").join("")}$("codeAccessType").onchange=()=>$("codeMinutesWrap").classList.toggle("hidden",$("codeAccessType").value==="permanent");$("genCode").onclick=async()=>{const permanent=$("codeAccessType").value==="permanent",minutes=Number($("codeMinutes").value);if(!permanent&&minutes<1){toast("Tempo inválido","","warn");return}const ok=await ask("Gerar código?",permanent?"Acesso permanente de uso único.":"Acesso por "+minutes+" minuto(s).","Gerar");if(!ok)return;try{const d=await api("/api/admin/codes",{method:"POST",body:JSON.stringify({accessType:permanent?"permanent":"minutes",minutes})});lastGeneratedCode=d.code;$("newCode").textContent=d.code;$("newCodeInfo").textContent=d.permanent?"Permanente":d.minutes+" minuto(s)";$("newCodeBox").classList.remove("hidden");toast("Código gerado");await loadCodes()}catch(e){toast("Erro",e.message,"error")}};$("copyNewCode").onclick=async()=>{if(lastGeneratedCode){await navigator.clipboard.writeText(lastGeneratedCode);toast("Código copiado")}};
function loadGroups(){return runLoad("groups",fetchGroups)}
async function fetchGroups(){const phone=$("groupPhone").value;const q=phone?"?phone="+encodeURIComponent($("groupPhone").value):"",d=await api("/api/admin/groups"+q);if(phone!==$("groupPhone").value)return fetchGroups();$("groupsRows").innerHTML=d.groups.map(g=>"<tr><td><b>"+esc(g.code)+"</b></td><td>"+esc(g.event_name||"—")+"</td><td>"+esc(g.phone_e164||"—")+"</td><td>"+g.used_devices+" / "+g.max_devices+"</td><td>"+dt(g.expires_at)+"</td><td><button class='btn' data-row-action='copy-group-link' data-row-value='"+esc(g.public_url)+"'>Copiar link</button></td></tr>").join("")}window.copyGroupLink=async l=>{await navigator.clipboard.writeText(l);toast("Link copiado")};$("groupPhone").oninput=()=>{clearTimeout(window.gt);window.gt=setTimeout(loadGroups,300)};
async function loadEvents(){const selected=$("reportEvent").value;try{const d=await api("/api/admin/events");events=d.events;$("reportEvent").innerHTML="<option value=''>Hoje / evento ativo</option>"+events.map(e=>"<option value='"+esc(e.id)+"'>"+esc(e.name)+" • "+dt(e.starts_at)+"</option>").join("");$("reportEvent").value=events.some(e=>e.id===selected)?selected:""}catch(e){loadNotice("reports","error","Não foi possível carregar os eventos. Tente novamente.");return false}return true}function loadReport(){return runLoad("reports",fetchReport)}
async function fetchReport(){const id=$("reportEvent").value,q=id?"?eventId="+encodeURIComponent(id):"";try{const d=await api("/api/admin/report"+q),s=d.summary;if(id!==$("reportEvent").value)return fetchReport();$("reportMetrics").innerHTML=[["Vendas",s.sales],["Compradores",s.buyers],["Visitantes",s.visitors],["Conversão",s.conversionPct+"%"],["Bruto",brl(s.grossCents)],["Taxas",brl(s.feesCents)],["Após taxas registradas",brl(s.netCents)],["Ocup. grupos",s.groupOccupancyPct+"%"]].map(x=>"<div class='metric'><div class='label'>"+x[0]+"</div><div class='value'>"+x[1]+"</div></div>").join("");drawChart("reportSalesChart",d.hourly,"sales",v=>String(v));drawChart("reportRevenueChart",d.hourly,"revenueCents",brl);$("reportPlans").innerHTML=d.plans.map(x=>"<tr><td>"+esc(x.name)+"</td><td>"+x.sales+"</td><td>"+brl(x.revenue_cents)+"</td></tr>").join("")}catch(e){throw e}}$("reportEvent").onchange=loadReport;$("reloadReport").onclick=loadReport;$("downloadCsv").onclick=()=>{const id=$("reportEvent").value;location.href="/api/admin/report.csv"+(id?"?eventId="+encodeURIComponent(id):"")};
function diagCard(n,item,details){const good=!!item?.ok;return"<div class='diag'><span class='lamp "+(good?"good":"bad")+"'></span><span class='muted'>"+esc(n)+"</span><b>"+(good?"OK":"ATENÇÃO")+"</b><div class='muted'>"+esc(details)+"</div></div>"}function loadDiagnostics(){return runLoad("diagnostics",fetchDiagnostics)}
async function fetchDiagnostics(){try{const d=await api("/api/admin/diagnostics");$("diagGrid").innerHTML=[diagCard("MikroTik",d.router,(d.router.identity||"RB")+" • "+(d.router.hosts||0)+" hosts • "+dt(d.router.lastSeenAt)),diagCard("D1",d.d1,d.d1.ok?"Resposta "+d.d1.latencyMs+" ms":(d.d1.error||"Falhou")),diagCard("Mercado Pago",d.mercadoPago,d.mercadoPago.ok?"Autenticação "+d.mercadoPago.latencyMs+" ms":(d.mercadoPago.error||"Não validado")),diagCard("Webhook",{ok:!!d.webhook.configured},d.webhook.lastSeenAt?"Último "+dt(d.webhook.lastSeenAt):"Sem webhook registrado"),diagCard("Mídia R2",d.media,d.media.ok?"Bucket conectado":"Binding MEDIA ausente"),diagCard("Pagamento recente",{ok:!!d.latestPayment},"Status: "+(d.latestPayment?.status||"nenhum")),diagCard("Pix pendentes",{ok:d.pendingPayments<20},String(d.pendingPayments)+" pendente(s)"),diagCard("Reconciliação",{ok:!!d.lastReconcileAt},d.lastReconcileAt?dt(d.lastReconcileAt):"Ainda não executada")].join("")}catch(e){throw e}}$("reloadDiagnostics").onclick=loadDiagnostics;$("reconcileBtn").onclick=async()=>{const ok=await ask("Reconciliar Mercado Pago?","Serão consultadas até 20 Orders recentes.","Reconciliar");if(!ok)return;$("reconcileBtn").disabled=true;try{const d=await api("/api/admin/reconcile",{method:"POST",body:"{}"});$("reconcileResult").textContent=d.checked+" verificados • "+d.changed+" alterados";toast("Reconciliação concluída",d.changed+" divergência(s) corrigida(s).");await loadDiagnostics()}catch(e){toast("Erro",e.message,"error")}finally{$("reconcileBtn").disabled=false}};
function loadAccounts(){return runLoad("team",fetchAccounts)}
async function fetchAccounts(){if(!can("admin"))return;try{const d=await api("/api/admin/accounts");accounts=d.accounts;$("accountsRows").innerHTML=accounts.map(a=>{const ac=a.source==="env"?"<span class='muted'>Conta principal</span>":"<button class='btn' data-row-action='edit-account' data-row-value='"+esc(a.id)+"'>Editar</button> <button class='btn danger' data-row-action='delete-account' data-row-value='"+esc(a.id)+"'>Excluir</button>";return"<tr><td>"+esc(a.display_name)+"</td><td>"+esc(a.username)+"</td><td>"+esc(a.role)+"</td><td>"+(a.enabled?"Ativo":"Inativo")+"</td><td>"+dt(a.last_login_at)+"</td><td>"+ac+"</td></tr>"}).join("")}catch(e){throw e}}$("newAccount").onclick=()=>{$("accountForm").classList.remove("hidden");$("accountId").value="";$("accountName").value="";$("accountUser").value="";$("accountRole").value="operator";$("accountPassword").value="";$("accountEnabled").checked=true};window.editAccount=id=>{const a=accounts.find(x=>x.id===id);if(!a||a.source==="env")return;$("accountForm").classList.remove("hidden");$("accountId").value=a.id;$("accountName").value=a.display_name;$("accountUser").value=a.username;$("accountRole").value=a.role;$("accountPassword").value="";$("accountEnabled").checked=!!a.enabled};$("cancelAccount").onclick=()=>$("accountForm").classList.add("hidden");$("saveAccount").onclick=async()=>{const id=$("accountId").value,ok=await ask(id?"Salvar usuário?":"Criar usuário?","Permissões entram em vigor no próximo login.",id?"Salvar":"Criar");if(!ok)return;try{await api("/api/admin/accounts"+(id?"/"+id:""),{method:id?"PUT":"POST",body:JSON.stringify({displayName:$("accountName").value,username:$("accountUser").value,role:$("accountRole").value,password:$("accountPassword").value,enabled:$("accountEnabled").checked})});$("accountForm").classList.add("hidden");toast("Usuário salvo");await loadAccounts()}catch(e){toast("Erro na conta",e.message,"error")}};window.deleteAccount=async id=>{const ok=await ask("Excluir usuário?","A conta deixará de acessar o painel.","Excluir",true);if(!ok)return;try{await api("/api/admin/accounts/"+id,{method:"DELETE"});toast("Conta excluída");await loadAccounts()}catch(e){toast("Erro",e.message,"error")}};
function loadAudit(){return runLoad("audit",fetchAudit)}
async function fetchAudit(){const d=await api("/api/admin/audit");$("auditRows").innerHTML=d.audit.map(a=>"<div style='padding:11px 0;border-bottom:1px solid var(--line)'><b>"+esc(a.action)+"</b><div class='muted'>"+dt(a.created_at)+" • "+esc(a.details_json||"")+"</div></div>").join("")}
document.querySelectorAll("label:not([for])").forEach(label=>{const input=label.nextElementSibling;if(input?.id&&["INPUT","SELECT","TEXTAREA"].includes(input.tagName))label.htmlFor=input.id});
document.querySelectorAll(".quick-action i").forEach((el,index)=>el.innerHTML=metricIcon(["sales","wifi","users","money"][index]));
boot();setInterval(()=>{if(!document.hidden&&me&&!$("app").classList.contains("hidden")&&["platform","dash","hotspots","routers"].includes(currentTab()))refreshPanel(false)},10000);
</script>
</body>
</html>`;
}
// ============================================================
// PORTAL HTML
// ============================================================

function portalPage(env) {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Open Wi-Fi</title><link rel="icon" href="/assets/site-logo?site=openwifi-main">
<style>
:root{color-scheme:dark;--card:#111827;--card2:#151f34;--line:#2a3854;--text:#f4f7ff;--muted:#98a6c1;--accent:#6ea8fe;--accent2:#8b7cf6;--warning:#f6c65b}
*{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--text);font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:radial-gradient(circle at 90% -10%,rgba(139,124,246,.24),transparent 35%),radial-gradient(circle at 0 20%,rgba(110,168,254,.18),transparent 34%),linear-gradient(180deg,#090d18,#0d1322);background-size:cover;background-position:center}.wrap{max-width:510px;margin:auto;padding:22px 15px 42px}.brand{text-align:center;padding:8px 0 22px}.logo{width:68px;height:68px;border-radius:21px;margin:0 auto 11px;display:block;object-fit:contain;background:#0b1120;border:1px solid var(--line);padding:4px}h1{font-size:26px;margin:0}.muted{color:var(--muted);font-size:13px;line-height:1.5}.card{background:rgba(17,24,39,.95);border:1px solid var(--line);border-radius:20px;padding:17px;margin-bottom:12px;box-shadow:0 20px 60px rgba(0,0,0,.28)}.title{font-size:18px;font-weight:900;margin-bottom:5px}.option-grid{display:grid;gap:10px}.option{width:100%;display:flex;align-items:center;gap:13px;text-align:left;border:1px solid var(--line);background:linear-gradient(145deg,#151f34,#101827);color:var(--text);padding:15px;border-radius:16px}.option:disabled{opacity:.55}.option .icon{flex:0 0 43px;height:43px;border-radius:13px;display:grid;place-items:center;background:rgba(110,168,254,.12);border:1px solid rgba(110,168,254,.20);font-size:19px}.option b{display:block}.option span{display:block;color:var(--muted);font-size:11px;margin-top:3px}.notice{border-color:rgba(246,198,91,.34);background:linear-gradient(145deg,rgba(246,198,91,.09),rgba(17,24,39,.95))}.plans{display:grid;gap:9px;margin-top:12px}.plan{width:100%;border:1px solid var(--line);background:var(--card2);color:var(--text);border-radius:15px;padding:13px;display:flex;justify-content:space-between;gap:12px;text-align:left}.price{color:#a8c9ff;font-weight:950;font-size:17px}.speed{font-size:10px;color:#b8c7df;margin-top:3px}label{display:block;color:var(--muted);font-size:11px;margin:9px 0 4px}input{width:100%;border:1px solid var(--line);background:#0a1020;color:var(--text);border-radius:12px;padding:11px}.check{display:flex;align-items:flex-start;gap:8px;color:#cbd6e9;font-size:12px;line-height:1.45;margin-top:11px}.check input{width:auto;margin-top:2px}.btn{width:100%;border:1px solid var(--line);background:#17233a;color:var(--text);border-radius:12px;padding:11px;margin-top:8px;font-weight:850}.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#07101f}.btn.back{background:transparent;color:var(--muted)}.hidden{display:none!important}.center{text-align:center}.qr{width:min(270px,80vw);background:#fff;padding:8px;border-radius:14px;margin:12px auto}.codebig{font-size:29px;color:#a8c9ff;font-weight:950}.badge{display:inline-flex;border:1px solid var(--line);border-radius:99px;padding:4px 8px;font-size:10px;color:#a8c9ff}.info{padding:11px 12px;border-radius:12px;background:rgba(110,168,254,.07);border:1px solid rgba(110,168,254,.18);color:#b9c9e5;font-size:12px}.error{color:#ff9ba5;font-size:12px;margin-top:7px}.about{white-space:pre-wrap;color:#c8d3e7;font-size:13px;line-height:1.65}
</style></head><body><div class="wrap">
<div class="brand"><img class="logo" id="portalLogo" src="/assets/site-logo?site=openwifi-main"><h1 id="brandTitle">Open Wi-Fi</h1><div class="muted" id="brandSub"></div></div>
<section class="card" id="loading"><div class="title">Preparando seu acesso</div><div class="muted" id="loadingText">Identificando este aparelho...</div></section>
<section class="card notice hidden" id="noticeBox"><div class="title" id="noticeTitle"></div><div class="muted" id="noticeText"></div></section>
<section class="card hidden" id="homeBox"><div class="title">O que você deseja fazer?</div><div class="muted" id="homeContext" style="margin-bottom:13px"></div><div class="option-grid">
<button class="option" id="goAccess"><div class="icon">⌁</div><div><b>Liberar internet</b><span id="accessOptionText">Veja os planos e pague pelo Pix.</span></div></button>
<button class="option" id="goCode"><div class="icon">#</div><div><b>Possui um código?</b><span>Use código de acesso ou de Dupla/Grupo.</span></div></button>
<button class="option" id="goAbout"><div class="icon">i</div><div><b>Conheça-nos</b><span>Saiba como o Open Wi-Fi funciona.</span></div></button>
<button class="option" id="goPrivacy"><div class="icon">§</div><div><b>Privacidade e termos</b><span>Veja quais informações são utilizadas.</span></div></button>
</div></section>
<section class="card hidden" id="plansBox"><div class="title" id="modeTitle">Planos</div><div class="muted" id="eventText"></div><div class="plans" id="plans"></div><button class="btn back" data-home>Voltar</button></section>
<section class="card hidden" id="aboutBox"><div class="title" id="aboutTitle"></div><div class="about" id="aboutText"></div><button class="btn back" data-home>Voltar</button></section>
<section class="card hidden" id="privacyBox"><div class="title" id="privacyTitle"></div><div class="about" id="privacyText"></div><div class="info" style="margin-top:12px">Quando exigido, o aceite é registrado para este aparelho e para a versão atual da política.</div><button class="btn back" data-home>Voltar</button></section>
<section class="card hidden" id="codeBox"><div class="title">Possui um código?</div><div class="muted">O sistema identifica automaticamente código administrativo ou de grupo.</div><label>Código</label><input id="codeInput" maxlength="16"><label class="check hidden" id="codePrivacyLine"><input id="codePrivacyCheck" type="checkbox"><span>Li e aceito a política de privacidade.</span></label><button class="btn primary" id="redeemCode">Liberar com código</button><button class="btn back" data-home>Voltar</button><div class="error" id="codeErr"></div></section>
<section class="card hidden" id="checkoutBox"><div class="title" id="checkoutTitle"></div><div class="muted" id="checkoutSub"></div><label>E-mail</label><input id="email" type="email"><label>WhatsApp</label><input id="phone" inputmode="tel"><div class="muted" id="phoneHint"></div><label class="check hidden" id="checkoutPrivacyLine"><input id="checkoutPrivacyCheck" type="checkbox"><span>Li e aceito a política de privacidade.</span></label><button class="btn primary" id="createPix">Gerar Pix</button><button class="btn back" id="backPlans">Voltar aos planos</button><div class="error" id="checkoutError"></div></section>
<section class="card hidden center" id="pixBox"><div class="title">Pague com Pix</div><div class="muted" id="pixPlan"></div><img class="qr" id="qr"><label style="text-align:left">Pix Copia e Cola</label><input id="pixCode" readonly><button class="btn primary" id="copyPix">Copiar Pix</button><div id="payStatus" style="margin-top:11px;font-weight:850">Aguardando pagamento...</div><div class="info" style="margin-top:12px">O QR continua válido mesmo se a janela temporária terminar.</div><button class="btn" id="startAttempt">Liberar internet por 30 s</button><div class="muted" id="attemptInfo"></div></section>
<section class="card hidden center" id="successBox"><div style="font-size:39px">✓</div><div class="title">Acesso liberado</div><div class="muted" id="successText"></div><div id="groupSuccess" class="hidden"><div style="margin-top:15px"><span class="badge">DUPLA / GRUPO</span></div><div class="muted">Código para os participantes</div><div class="codebig" id="groupCode"></div><button class="btn" id="copyGroupCode">Copiar código</button><button class="btn" id="copyGroupLink">Copiar link de acompanhamento</button></div></section>
<div class="muted center" id="support"></div></div>
<script>
const q=new URLSearchParams(location.search),siteId=q.get("site")||"openwifi-main",mac=(q.get("mac")||"").toUpperCase(),ip=q.get("ip")||"",KEY="openwifi_device_id_v1";let deviceId=localStorage.getItem(KEY)||crypto.randomUUID();localStorage.setItem(KEY,deviceId);let selectedPlan,currentPayment,pollTimer,siteData,currentGroup;const $=id=>document.getElementById(id),show=id=>$(id).classList.remove("hidden"),hide=id=>$(id).classList.add("hidden"),brl=c=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(c/100),esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m]));async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{"content-type":"application/json",...(opt.headers||{})}}),d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||"Erro");e.data=d;throw e}return d}
function dur(p){if(p.party_until_event_end)return"Até o fim do evento";const s=Number(p.duration_seconds||0);if(s===3600)return"1 hora";if(s===86400)return"1 dia";if(s===604800)return"1 semana";if(s===2592000)return"30 dias";if(s<3600)return Math.round(s/60)+" min";return Math.round(s/3600)+" h"}function speed(p){const d=Number(p.rate_limit_down_kbps||0),u=Number(p.rate_limit_up_kbps||0);if(!d&&!u)return"";return(d?Math.round(d/1000)+" Mbps download":"download livre")+" • "+(u?Math.round(u/1000)+" Mbps upload":"upload livre")}function showOnly(id){["homeBox","plansBox","aboutBox","privacyBox","codeBox","checkoutBox","pixBox","successBox"].forEach(x=>hide(x));show(id)}
function applySite(d){$("brandTitle").textContent=d.site.portalTitle;$("brandSub").textContent=d.site.portalSubtitle;$("aboutTitle").textContent=d.site.aboutTitle||"Conheça o Open Wi-Fi";$("aboutText").textContent=d.site.aboutText||"";$("privacyTitle").textContent=d.site.privacy?.title||"Privacidade";$("privacyText").textContent=d.site.privacy?.text||"";$("modeTitle").textContent=d.site.mode==="party"?"Planos do evento":"Planos disponíveis";$("eventText").textContent=d.event?d.event.name+" • até "+new Date(d.event.ends_at).toLocaleString("pt-BR"):"";$("homeContext").textContent=d.site.mode==="party"?(d.event?d.event.name+" • Modo Party":"Modo Party"):"Modo Padrão";$("support").textContent=d.site.supportWhatsapp?"Suporte WhatsApp: +"+d.site.supportWhatsapp:"";$("portalLogo").src="/assets/site-logo?site="+encodeURIComponent(siteId)+"&v="+Date.now();$("checkoutPrivacyLine").classList.toggle("hidden",!d.site.privacy?.requireAccept);$("codePrivacyLine").classList.toggle("hidden",!d.site.privacy?.requireAccept);if(d.site.notice){$("noticeTitle").textContent=d.site.notice.title;$("noticeText").textContent=d.site.notice.text;show("noticeBox")}else hide("noticeBox");if(!d.site.salesEnabled){$("goAccess").disabled=true;$("accessOptionText").textContent=d.site.emergencyMessage||"Novas vendas pausadas."}else{$("goAccess").disabled=false;$("accessOptionText").textContent="Veja os planos e faça a liberação pelo Pix."}if(d.site.backgroundMode==="image"&&d.site.backgroundImageUrl)document.body.style.backgroundImage="linear-gradient(rgba(5,8,16,.62),rgba(5,8,16,.72)),url('/assets/site-background?site="+encodeURIComponent(siteId)+"&v="+Date.now()+"')"}
async function boot(){if(!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)){$("loadingText").textContent="Abra esta página pela rede Open Wi-Fi.";return}try{const reg=await api("/api/device/register",{method:"POST",body:JSON.stringify({siteId,mac,ip,deviceId})});deviceId=reg.deviceId;localStorage.setItem(KEY,deviceId);if(reg.activeUntil>Date.now()){hide("loading");show("successBox");$("successText").textContent="Este aparelho já possui acesso ativo até "+new Date(reg.activeUntil).toLocaleString("pt-BR")+".";return}const d=await api("/api/plans?site="+encodeURIComponent(siteId));siteData=d;applySite(d);renderPlans(d.plans);hide("loading");show("homeBox")}catch(e){$("loadingText").textContent=e.message}}
function renderPlans(ps){$("plans").innerHTML=ps.map(p=>"<button class='plan' data-id='"+esc(p.id)+"'><span><b>"+esc(p.name)+"</b><br><small>"+dur(p)+(p.max_devices>1?" • "+p.max_devices+" dispositivos":"")+"</small>"+(speed(p)?"<div class='speed'>"+esc(speed(p))+"</div>":"")+"</span><span class='price'>"+brl(p.price_cents)+"</span></button>").join("");document.querySelectorAll(".plan").forEach(b=>b.onclick=()=>choosePlan(ps.find(p=>p.id===b.dataset.id)))}$("goAccess").onclick=()=>{if(siteData.site.salesEnabled)showOnly("plansBox")};$("goCode").onclick=()=>{showOnly("codeBox");$("codeInput").value="";$("codeErr").textContent=""};$("goAbout").onclick=()=>showOnly("aboutBox");$("goPrivacy").onclick=()=>showOnly("privacyBox");document.querySelectorAll("[data-home]").forEach(b=>b.onclick=()=>showOnly("homeBox"));function choosePlan(p){selectedPlan=p;$("checkoutTitle").textContent=p.name+" • "+brl(p.price_cents);$("checkoutSub").textContent=dur(p)+(p.max_devices>1?" • "+p.max_devices+" dispositivos":"")+(speed(p)?" • "+speed(p):"");$("phoneHint").textContent=(siteData.site.mode==="party"||siteData.site.requireWhatsappStandard)?"WhatsApp obrigatório.":"WhatsApp opcional.";showOnly("checkoutBox")}$("backPlans").onclick=()=>showOnly("plansBox");
async function privacy(checkId,errorId){if(!siteData.site.privacy?.requireAccept)return true;if(!$(checkId).checked){$(errorId).textContent="É necessário aceitar a política de privacidade.";return false}try{await api("/api/privacy/accept",{method:"POST",body:JSON.stringify({siteId,deviceId})});return true}catch(e){$(errorId).textContent="Não foi possível registrar o aceite.";return false}}
$("redeemCode").onclick=async()=>{$("codeErr").textContent="";if(!(await privacy("codePrivacyCheck","codeErr")))return;const payload={siteId,deviceId,mac,code:$("codeInput").value};try{const d=await api("/api/access-code/redeem",{method:"POST",body:JSON.stringify(payload)});showOnly("successBox");$("successText").textContent=d.permanent?"Acesso permanente liberado.":"Acesso liberado até "+new Date(d.access.ends_at).toLocaleString("pt-BR")+".";return}catch(e){if(e.data?.error!=="access_code_not_found"){$("codeErr").textContent=e.message;return}}try{const d=await api("/api/group/join",{method:"POST",body:JSON.stringify(payload)});showOnly("successBox");$("successText").textContent="Código de grupo aceito.";if(d.group)showGroup(d.group)}catch{$("codeErr").textContent="Código não encontrado, expirado ou sem vagas."}};
$("createPix").onclick=async()=>{$("checkoutError").textContent="";if(!(await privacy("checkoutPrivacyCheck","checkoutError")))return;try{const d=await api("/api/payments/create",{method:"POST",body:JSON.stringify({siteId,deviceId,planId:selectedPlan.id,mac,ip,email:$("email").value,phone:$("phone").value})});currentPayment=d.payment;showOnly("pixBox");$("pixPlan").textContent=d.payment.planName+" • "+brl(d.payment.amountCents);$("pixCode").value=d.payment.qrCode||"";if(d.payment.qrCodeBase64)$("qr").src="data:image/png;base64,"+d.payment.qrCodeBase64;renderAttempt(null);startPolling(d.payment.id)}catch(e){$("checkoutError").textContent=e.data?.reason||e.message}};$("copyPix").onclick=async()=>{try{await navigator.clipboard.writeText($("pixCode").value);$("copyPix").textContent="Pix copiado ✓";setTimeout(()=>$("copyPix").textContent="Copiar Pix",1400)}catch{}};
function renderAttempt(a){const now=Date.now(),btn=$("startAttempt"),info=$("attemptInfo");if(!a){btn.disabled=false;btn.textContent="Liberar internet por 30 s";info.textContent="";return}if(a.waitingRouter){btn.disabled=true;btn.textContent="Liberando...";info.textContent="Aguardando a MikroTik. Os 30 segundos ainda não começaram.";return}if(a.activeUntil>now){btn.disabled=true;btn.textContent="Internet temporária ativa";info.textContent="Tentativa "+a.activeAttemptNumber+"/"+a.maxAttempts+" • "+Math.max(0,Math.ceil((a.activeUntil-now)/1000))+" s restantes";return}if(a.cooldownUntil>now){btn.disabled=true;btn.textContent="Aguarde";info.textContent="Novas tentativas em "+Math.ceil((a.cooldownUntil-now)/1000)+" s";return}btn.disabled=false;btn.textContent="Liberar internet por 30 s";info.textContent=a.attemptsUsed+"/"+a.maxAttempts+" tentativas usadas"}$("startAttempt").onclick=async()=>{try{const d=await api("/api/payments/"+currentPayment.id+"/attempt",{method:"POST",body:JSON.stringify({deviceId,mac})});renderAttempt(d.attempt)}catch(e){if(e.data?.attempt)renderAttempt(e.data.attempt);else $("attemptInfo").textContent="Falha ao liberar: "+(e.data?.error||e.message)}};function showGroup(g){currentGroup=g;$("groupCode").textContent=g.code;show("groupSuccess");$("copyGroupCode").onclick=()=>navigator.clipboard.writeText(g.code);$("copyGroupLink").onclick=()=>navigator.clipboard.writeText(g.publicUrl)}function startPolling(id){clearInterval(pollTimer);const poll=async()=>{try{const d=await api("/api/payments/"+id);renderAttempt(d.attempt);if(d.payment.status==="approved"){clearInterval(pollTimer);showOnly("successBox");$("successText").textContent=d.access?.ends_at?"Acesso válido até "+new Date(d.access.ends_at).toLocaleString("pt-BR")+".":"Pagamento confirmado.";if(d.group)showGroup(d.group)}}catch{}};poll();pollTimer=setInterval(poll,2500)}boot();
</script></body></html>`;
}// ============================================================
// ROUTER ACK compatibility
// ============================================================

async function routerAck(request, env) {
  const auth=await authenticateRouter(request,env);
  if(!auth)return json({ok:false,error:"unauthorized"},401);
  return json({ok:true,acked:0,routerId:auth.routerId||null});
}

// ============================================================
// ROUTER
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    const path=url.pathname;

    try {

    if(request.method==="GET"&&path==="/"){
      return new Response(
        ["Open Wi-Fi Cloudflare v1.5.1 SaaS Control","","Portal: /portal","Admin: /admin","Health: /health"].join("\n"),
        {headers:{"content-type":"text/plain; charset=utf-8"}}
      );
    }

    if(request.method==="GET"&&path==="/health")return health(env);
    if(request.method==="GET"&&path==="/favicon.svg")return fallbackLogoResponse();
    if(request.method==="GET"&&path==="/assets/logo.svg")return fallbackLogoResponse();
    if(request.method==="GET"&&path==="/assets/site-logo")return siteImageAsset(url,env,"logo");
    if(request.method==="GET"&&path==="/assets/site-background")return siteImageAsset(url,env,"background");
    if(request.method==="GET"&&path==="/portal")return html(portalPage(env));
    if(request.method==="GET"&&path==="/group")return html(groupPage());
    if(request.method==="GET"&&path==="/admin")return html(adminPage());

    if(request.method==="GET"&&path==="/api/site/status")return siteStatus(env);
    if(request.method==="GET"&&path==="/api/plans")return listPlans(url,env);
    if(request.method==="GET"&&path==="/api/group/public")return publicGroupData(url,env);

    if(request.method==="POST"&&path==="/api/device/register")return registerDevice(request,env);
    if(request.method==="POST"&&path==="/api/privacy/accept")return acceptPrivacy(request,env);
    if(request.method==="POST"&&path==="/api/payments/create")return createPayment(request,env);
    if(request.method==="POST"&&path==="/api/access-code/redeem")return redeemAccessCode(request,env);
    if(request.method==="POST"&&path==="/api/group/join")return joinPartyGroup(request,env);

    const attemptMatch=path.match(/^\/api\/payments\/([0-9a-fA-F-]{36})\/attempt$/);
    if(request.method==="POST"&&attemptMatch)return startPaymentAttempt(request,env,attemptMatch[1]);

    const paymentMatch=path.match(/^\/api\/payments\/([0-9a-fA-F-]{36})$/);
    if(request.method==="GET"&&paymentMatch)return paymentStatus(url,env,paymentMatch[1]);

    if(request.method==="POST"&&path==="/api/mercadopago/webhook")return mercadoPagoWebhook(request,url,env,ctx);

    // MikroTik: adoção, instalação e agente.
    if(request.method==="POST"&&path==="/api/router/enroll")return routerEnroll(request,env);
    if(request.method==="GET"&&path==="/api/router/installer.rsc")return routerInstallerRsc(request,env);
    if(request.method==="GET"&&path==="/api/router/agent.rsc")return routerAgentRsc(request,env);
    if(request.method==="GET"&&path==="/api/router/login.html")return routerLoginHtml(url,env);
    if(request.method==="POST"&&path==="/api/router/install-status")return routerInstallStatus(request,env);
    if(request.method==="POST"&&path==="/api/router/poll")return routerPoll(request,env);
    if(request.method==="POST"&&path==="/api/router/ack")return routerAck(request,env);

    if(request.method==="POST"&&path==="/api/admin/login")return adminLogin(request,env);
    if(request.method==="POST"&&path==="/api/admin/logout")return adminLogout();

    if(path.startsWith("/api/admin/")){
      const session=await readAdminSession(request,env);
      if(!session)return json({ok:false,error:"unauthorized"},401);

      const deny=()=>json({ok:false,error:"forbidden",requiredRole:"higher"},403);
      const viewer=()=>roleAtLeast(session,"viewer");
      const operator=()=>roleAtLeast(session,"operator");
      const admin=()=>roleAtLeast(session,"admin");

      if(request.method==="GET"&&path==="/api/admin/me")return adminMe(request,env);

      if(request.method==="GET"&&path==="/api/admin/platform"&&viewer())return adminPlatform(env);
      if(request.method==="GET"&&path==="/api/admin/dashboard"&&viewer())return adminDashboard(env);
      if(request.method==="GET"&&path==="/api/admin/routers"&&viewer())return adminRouters(env);
      if(request.method==="POST"&&path==="/api/admin/routers/enrollment"){
        if(!admin())return deny();
        return adminCreateRouterEnrollment(request,env);
      }
      const routerDisable=path.match(/^\/api\/admin\/routers\/([^/]+)\/disable$/);
      if(routerDisable&&request.method==="POST"){
        if(!admin())return deny();
        return adminRouterDisable(env,routerDisable[1]);
      }
      const routerDelete=path.match(/^\/api\/admin\/routers\/([^/]+)$/);
      if(routerDelete&&request.method==="DELETE"){
        if(!admin())return deny();
        return adminRouterDelete(env,routerDelete[1]);
      }

      if(request.method==="GET"&&path==="/api/admin/analytics"&&viewer())return adminAnalytics(env);
      if(request.method==="GET"&&path==="/api/admin/diagnostics"&&viewer())return adminDiagnostics(env);
      if(request.method==="GET"&&path==="/api/admin/events"&&viewer())return adminEvents(env);
      if(request.method==="GET"&&path==="/api/admin/report"&&viewer())return adminReport(url,env);
      if(request.method==="GET"&&path==="/api/admin/report.csv"&&viewer())return adminReportCsv(url,env);

      if(request.method==="GET"&&path==="/api/admin/users"&&viewer())return adminUsers(env);
      const userDetail=path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if(request.method==="GET"&&userDetail&&viewer())return adminUserDetail(env,userDetail[1]);
      const courtesy=path.match(/^\/api\/admin\/users\/([^/]+)\/courtesy$/);
      if(request.method==="POST"&&courtesy){
        if(!operator())return deny();
        return adminCourtesy(request,env,courtesy[1]);
      }
      if(request.method==="POST"&&path==="/api/admin/users/revoke"){
        if(!operator())return deny();
        return adminRevokeUsersAccess(request,env);
      }

      if(request.method==="GET"&&path==="/api/admin/plans"&&viewer())return adminPlans(env);
      if(request.method==="POST"&&path==="/api/admin/plans"){
        if(!admin())return deny();
        return adminPlanSave(request,env);
      }
      const pm=path.match(/^\/api\/admin\/plans\/([^/]+)$/);
      if(pm&&request.method==="PUT"){
        if(!admin())return deny();
        return adminPlanSave(request,env,pm[1]);
      }
      if(pm&&request.method==="DELETE"){
        if(!admin())return deny();
        return adminPlanDelete(env,pm[1]);
      }

      if(request.method==="PUT"&&path==="/api/admin/config"){
        if(!admin())return deny();
        return adminConfigSave(request,env);
      }
      if(request.method==="PUT"&&path==="/api/admin/event"){
        if(!admin())return deny();
        return adminEventSave(request,env);
      }
      if(request.method==="POST"&&path==="/api/admin/emergency"){
        if(!operator())return deny();
        return adminEmergency(request,env);
      }

      if(request.method==="GET"&&path==="/api/admin/codes"&&viewer())return adminCodes(env);
      if(request.method==="POST"&&path==="/api/admin/codes"){
        if(!operator())return deny();
        return adminGenerateCode(request,env);
      }

      if(request.method==="GET"&&path==="/api/admin/groups"&&viewer())return adminGroups(url,env);
      if(request.method==="GET"&&path==="/api/admin/audit"&&viewer())return adminAudit(env);

      if(request.method==="POST"&&path==="/api/admin/reconcile"){
        if(!operator())return deny();
        return adminReconcile(env);
      }

      const upload=path.match(/^\/api\/admin\/media\/(logo|background)$/);
      if(upload&&request.method==="POST"){
        if(!admin())return deny();
        return adminUploadMedia(request,env,upload[1]);
      }
      if(upload&&request.method==="DELETE"){
        if(!admin())return deny();
        return adminDeleteMedia(env,upload[1]);
      }

      if(request.method==="GET"&&path==="/api/admin/accounts"){
        if(!admin())return deny();
        return adminAccounts(env);
      }
      if(request.method==="POST"&&path==="/api/admin/accounts"){
        if(!admin())return deny();
        return adminAccountSave(request,env);
      }
      const account=path.match(/^\/api\/admin\/accounts\/([^/]+)$/);
      if(account&&request.method==="PUT"){
        if(!admin())return deny();
        return adminAccountSave(request,env,account[1]);
      }
      if(account&&request.method==="DELETE"){
        if(!admin())return deny();
        if(account[1]==="env-owner")return json({ok:false,error:"owner_cannot_be_deleted"},409);
        return adminAccountDelete(env,account[1]);
      }

      return deny();
    }

    return json({ok:false,error:"not_found"},404);
    } catch(error) {
      console.error(JSON.stringify({
        message:"unhandled request error",
        method:request.method,
        path,
        error:error instanceof Error?error.message:String(error)
      }));
      return json({ok:false,error:"internal_error"},500);
    }
  },
};
