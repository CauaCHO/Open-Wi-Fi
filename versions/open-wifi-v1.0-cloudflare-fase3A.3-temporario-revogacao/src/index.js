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
        "default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });

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
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length || !a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function createAdminSession(env) {
  if (!env.ADMIN_SESSION_SECRET) throw new Error("ADMIN_SESSION_SECRET_not_configured");
  const hours = Number(env.ADMIN_SESSION_HOURS || 12);
  const payload = JSON.stringify({
    sub: env.ADMIN_USER || "admin",
    exp: Date.now() + hours * 3600000,
    nonce: randomToken(8),
  });
  const encoded = stringToBase64Url(payload);
  const sig = await hmacBase64Url(env.ADMIN_SESSION_SECRET, encoded);
  return `${encoded}.${sig}`;
}

async function verifyAdminSession(request, env) {
  if (!env.ADMIN_SESSION_SECRET) return false;
  const token = cookieValue(request, "ow_admin");
  if (!token || !token.includes(".")) return false;
  const [payload64, sig] = token.split(".", 2);
  const expected = await hmacBase64Url(env.ADMIN_SESSION_SECRET, payload64);
  if (!constantEqual(sig, expected)) return false;
  try {
    const payload = JSON.parse(base64UrlToString(payload64));
    return payload.sub === (env.ADMIN_USER || "admin") && Number(payload.exp) > Date.now();
  } catch {
    return false;
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

async function requireRouter(request, env) {
  const token = bearer(request);
  return !!env.ROUTER_API_TOKEN && !!token && token === env.ROUTER_API_TOKEN;
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
    version: "1.0.0-phase3A.3",
    mercadoPagoConfigured: !!env.MP_ACCESS_TOKEN,
    webhookSecretConfigured: !!env.MP_WEBHOOK_SECRET,
    time: new Date().toISOString(),
  });
}

// ============================================================
// ROUTER / FASE 1.2
// ============================================================

async function syncRouterHosts(env, siteId, incomingHosts, now) {
  const touchMs = Number(env.ROUTER_HOST_TOUCH_MS || 1800000);

  const stored = await env.DB.prepare(`
    SELECT mac, ip, hostname, last_seen_at
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
          INSERT INTO router_hosts (site_id, mac, ip, hostname, last_seen_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(siteId, mac, host.ip, host.hostname, now)
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
                 last_seen_at = ?
           WHERE site_id = ? AND mac = ?
        `).bind(host.ip, host.hostname, now, siteId, mac)
      );
    }
  }

  for (const [mac] of existing) {
    if (!incoming.has(mac)) {
      statements.push(
        env.DB.prepare(`
          DELETE FROM router_hosts
           WHERE site_id = ? AND mac = ?
        `).bind(siteId, mac)
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
  if (!(await requireRouter(request, env))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const siteId = String(body.siteId || env.OPENWIFI_SITE_ID || "").trim();
  if (!siteId) return json({ ok: false, error: "site_id_required" }, 400);

  await ensureSite(env, siteId);

  const now = Date.now();
  const heartbeatMs = Number(env.ROUTER_HEARTBEAT_MS || 30000);
  const hosts = Array.isArray(body.hosts) ? body.hosts.slice(0, 2000) : [];

  const site = await env.DB.prepare(`
    SELECT router_last_seen_at
      FROM sites
     WHERE id = ?
  `).bind(siteId).first();

  const lastSeen = Number(site?.router_last_seen_at || 0);
  const heartbeatDue = !lastSeen || (now - lastSeen >= heartbeatMs);

  let hostSync = null;

  if (heartbeatDue) {
    hostSync = await syncRouterHosts(env, siteId, hosts, now);

    await env.DB.prepare(`
      UPDATE sites
         SET router_last_seen_at = ?,
             router_version = ?,
             router_board = ?,
             router_identity = ?,
             router_host_count = ?,
             updated_at = ?
       WHERE id = ?
    `).bind(
      now,
      body.router?.version || null,
      body.router?.board || null,
      body.router?.identity || null,
      hosts.length,
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
    SELECT mac, MAX(ends_at) AS ends_at
      FROM (
        SELECT dm.mac AS mac, ag.ends_at AS ends_at
          FROM access_grants ag
          JOIN device_macs dm
            ON dm.device_id = ag.device_id
           AND dm.site_id = ag.site_id
         WHERE ag.site_id = ?
           AND ag.status = 'active'
           AND ag.starts_at <= ?
           AND ag.ends_at > ?

        UNION ALL

        SELECT aa.mac AS mac, aa.ends_at AS ends_at
          FROM access_attempts aa
         WHERE aa.site_id = ?
           AND aa.status = 'active'
           AND aa.router_started_at IS NOT NULL
           AND aa.starts_at <= ?
           AND aa.ends_at > ?
      )
     GROUP BY mac
     ORDER BY ends_at ASC
  `).bind(siteId, now, now, siteId, now, now).all();

  return json({
    ok: true,
    siteId,
    serverTime: now,
    pollAfterMs: 10000,
    heartbeatPersisted: heartbeatDue,
    hostSync,
    access: active.results.map((r) => ({
      mac: normalizeMac(r.mac),
      until: Number(r.ends_at),
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
           portal_title, portal_subtitle, about_title, about_text
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
           max_devices, sort_order, mode
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
    now, now, localStatus, now, paymentRow.id
  ).run();

  if (localStatus === "approved") {
    const plan = await env.DB.prepare(`
      SELECT id, name, mode, duration_seconds, party_until_event_end, max_devices
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
          (id, site_id, device_id, payment_id, starts_at, ends_at,
           status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(
        `grant-${paymentRow.id}`, paymentRow.site_id, paymentRow.device_id,
        paymentRow.id, now, endsAt, now, now
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

function secureEqualHex(a, b) {
  a = String(a || "").toLowerCase();
  b = String(b || "").toLowerCase();
  if (a.length !== b.length || !a.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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

  // MP pede resposta 200/201 rapidamente. O processamento segue no waitUntil.
  ctx.waitUntil(syncWebhookOrder(env, orderId).catch((err) => {
    console.error("MP webhook sync failed", err);
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
        id,site_id,device_id,payment_id,starts_at,ends_at,status,created_at,updated_at
      )
      VALUES(?,?,?,NULL,?,?,'active',?,?)
      ON CONFLICT(id) DO NOTHING
    `).bind(`code-${row.id}`,siteId,deviceId,now,endsAt,now,now)
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
  const mapping=await env.DB.prepare(`SELECT device_id FROM device_macs WHERE site_id=? AND mac=?`).bind(siteId,mac).first();
  if(!mapping||mapping.device_id!==deviceId)return json({ok:false,error:"device_mac_mismatch"},403);

  const now=Date.now();
  const group=await env.DB.prepare(`SELECT * FROM party_groups WHERE site_id=? AND code=? AND expires_at>? LIMIT 1`).bind(siteId,code,now).first();
  if(!group)return json({ok:false,error:"group_not_found_or_expired"},404);

  const already=await env.DB.prepare(`SELECT 1 AS ok FROM group_members WHERE group_id=? AND device_id=?`).bind(group.id,deviceId).first();
  if(!already){
    const another=await env.DB.prepare(`
      SELECT pg.id FROM group_members gm JOIN party_groups pg ON pg.id=gm.group_id
       WHERE gm.device_id=? AND pg.site_id=? AND pg.expires_at>? AND pg.id<>? LIMIT 1
    `).bind(deviceId,siteId,now,group.id).first();
    if(another)return json({ok:false,error:"device_in_another_group"},409);

    const count=await env.DB.prepare(`SELECT COUNT(*) AS c FROM group_members WHERE group_id=?`).bind(group.id).first();
    if(Number(count?.c||0)>=Number(group.max_devices))return json({ok:false,error:"group_full"},409);

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO group_members(group_id,device_id,joined_at,is_owner) VALUES(?,?,?,0)`).bind(group.id,deviceId,now),
      env.DB.prepare(`
        INSERT INTO access_grants(id,site_id,device_id,payment_id,starts_at,ends_at,status,created_at,updated_at)
        VALUES(?,?,?,NULL,?,?,'active',?,?)
        ON CONFLICT(id) DO UPDATE SET ends_at=excluded.ends_at,status='active',updated_at=excluded.updated_at
      `).bind(`group-${group.id}-${deviceId}`,siteId,deviceId,now,Number(group.expires_at),now,now)
    ]);
  }

  const c=await env.DB.prepare(`SELECT COUNT(*) AS c FROM group_members WHERE group_id=?`).bind(group.id).first();
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
// ============================================================
// ADMIN
// ============================================================

async function adminLogin(request, env){
  let b;try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  if(!env.ADMIN_PASSWORD||String(b.user||"")!==(env.ADMIN_USER||"admin")||String(b.password||"")!==env.ADMIN_PASSWORD){
    return json({ok:false,error:"invalid_credentials"},401);
  }
  const s=await createAdminSession(env),hours=Number(env.ADMIN_SESSION_HOURS||12);
  return json({ok:true},200,{"set-cookie":`ow_admin=${s}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(hours*3600)}`});
}

async function adminLogout(){
  return json({ok:true},200,{"set-cookie":"ow_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
}

async function adminDashboard(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main",now=Date.now(),{start,end}=saoPauloDayBounds(now);
  const site=await env.DB.prepare(`SELECT * FROM sites WHERE id=?`).bind(siteId).first();
  const event=site?.active_event_id?await env.DB.prepare(`SELECT * FROM events WHERE id=?`).bind(site.active_event_id).first():null;
  const [paid,revenue,active,pending,attempts,groups,payments]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS c FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<?`).bind(siteId,start,end).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS v FROM payments WHERE site_id=? AND status='approved' AND approved_at>=? AND approved_at<?`).bind(siteId,start,end).first(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM access_grants WHERE site_id=? AND status='active' AND ends_at>?`).bind(siteId,now).first(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM payments WHERE site_id=? AND status='pending'`).bind(siteId).first(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM access_attempts WHERE site_id=? AND status='active' AND ends_at>?`).bind(siteId,now).first(),
    env.DB.prepare(`SELECT pg.id,pg.code,pg.phone_e164,pg.max_devices,pg.expires_at,COUNT(gm.device_id) AS used_devices FROM party_groups pg LEFT JOIN group_members gm ON gm.group_id=pg.id WHERE pg.site_id=? AND pg.expires_at>? GROUP BY pg.id ORDER BY pg.created_at DESC LIMIT 20`).bind(siteId,now).all(),
    env.DB.prepare(`SELECT p.id,p.status,p.amount_cents,p.payer_email,p.phone_e164,p.created_at,p.approved_at,pl.name AS plan_name FROM payments p JOIN plans pl ON pl.id=p.plan_id WHERE p.site_id=? ORDER BY p.created_at DESC LIMIT 20`).bind(siteId).all()
  ]);
  return json({ok:true,site,event,metrics:{
    routerOnline:!!site?.router_last_seen_at&&now-Number(site.router_last_seen_at)<=Number(env.ROUTER_OFFLINE_AFTER_MS||90000),
    routerHostCount:Number(site?.router_host_count||0),paidToday:Number(paid?.c||0),revenueTodayCents:Number(revenue?.v||0),
    activeGrants:Number(active?.c||0),pendingPayments:Number(pending?.c||0),
    activeAttempts:Number(attempts?.c||0)
  },groups:groups.results,recentPayments:payments.results});
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
  const price=Math.max(0,Math.round(Number(b.priceCents||0))),eventEnd=b.partyUntilEventEnd?1:0;
  const duration=eventEnd?null:Math.max(60,Math.round(Number(b.durationSeconds||3600)));
  const max=Math.max(1,Math.min(20,Math.round(Number(b.maxDevices||1)))),enabled=b.enabled===false?0:1;
  if(id){
    await env.DB.prepare(`UPDATE plans SET mode=?,slug=?,name=?,price_cents=?,duration_seconds=?,party_until_event_end=?,max_devices=?,enabled=?,sort_order=?,updated_at=? WHERE id=? AND site_id=?`).bind(mode,slug,name,price,duration,eventEnd,max,enabled,Number(b.sortOrder||0),now,id,siteId).run();
    await audit(env,siteId,"plan.update",{id,name,price});
  }else{
    await env.DB.prepare(`INSERT INTO plans(id,site_id,mode,slug,name,price_cents,duration_seconds,party_until_event_end,max_devices,enabled,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(pid,siteId,mode,slug,name,price,duration,eventEnd,max,enabled,Number(b.sortOrder||0),now,now).run();
    await audit(env,siteId,"plan.create",{id:pid,name,price});
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
  try{b=await request.json()}
  catch{return json({ok:false,error:"invalid_json"},400)}

  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const mode=b.mode==="party"?"party":"standard";
  const bg=b.backgroundMode==="image"?"image":"gradient";
  const bgUrl=bg==="image"&&/^https:\/\//.test(String(b.backgroundImageUrl||""))
    ?String(b.backgroundImageUrl)
    :null;

  await env.DB.prepare(`
    UPDATE sites
       SET mode=?,
           background_mode=?,
           background_image_url=?,
           support_whatsapp=?,
           require_whatsapp_standard=?,
           sales_enabled=?,
           portal_title=?,
           portal_subtitle=?,
           about_title=?,
           about_text=?,
           updated_at=?
     WHERE id=?
  `).bind(
    mode,
    bg,
    bgUrl,
    normalizePhone(b.supportWhatsapp)||null,
    b.requireWhatsappStandard?1:0,
    b.salesEnabled===false?0:1,
    String(b.portalTitle||"Open Wi-Fi").slice(0,80),
    String(b.portalSubtitle||"Escolha seu acesso, pague via Pix e conecte.").slice(0,180),
    String(b.aboutTitle||"Conheça o Open Wi-Fi").slice(0,100),
    String(b.aboutText||"").slice(0,1200),
    Date.now(),
    siteId
  ).run();

  await audit(env,siteId,"site.config",{
    mode,bg,salesEnabled:b.salesEnabled!==false
  });

  return json({ok:true});
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
  const r=await env.DB.prepare(`SELECT action,details_json,created_at FROM admin_audit WHERE site_id=? ORDER BY created_at DESC LIMIT 50`).bind(siteId).all();
  return json({ok:true,audit:r.results});
}

function adminPage(){
return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Open Wi-Fi • Administração</title>
<style>
:root{
  color-scheme:dark;
  --bg:#090d18;
  --panel:#101625;
  --panel2:#151d30;
  --line:#263149;
  --text:#f4f7ff;
  --muted:#8f9bb3;
  --accent:#6ea8fe;
  --accent2:#8b7cf6;
  --danger:#ff6b7a;
  --warning:#f6c65b;
  --shadow:0 22px 70px rgba(0,0,0,.32);
}
*{box-sizing:border-box}
body{margin:0;background:
radial-gradient(circle at 90% -10%,rgba(139,124,246,.18),transparent 34%),
radial-gradient(circle at 5% 15%,rgba(110,168,254,.12),transparent 30%),
var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
button,input,select,textarea{font:inherit}
button{touch-action:manipulation}
.shell{min-height:100vh;display:grid;grid-template-columns:250px minmax(0,1fr)}
.sidebar{position:sticky;top:0;height:100vh;padding:22px 16px;border-right:1px solid var(--line);background:rgba(10,15,27,.92);backdrop-filter:blur(18px)}
.brand{display:flex;align-items:center;gap:11px;padding:4px 8px 24px}
.logo{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,var(--accent),var(--accent2));font-weight:900;color:#07101f}
.brand b{font-size:16px}.brand span{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.nav{display:grid;gap:5px}
.nav button{display:flex;align-items:center;gap:11px;width:100%;border:0;background:transparent;color:var(--muted);padding:11px 12px;border-radius:12px;text-align:left;cursor:pointer}
.nav button:hover{background:var(--panel2);color:var(--text)}
.nav button.active{background:linear-gradient(90deg,rgba(110,168,254,.18),rgba(139,124,246,.10));color:var(--text);box-shadow:inset 3px 0 0 var(--accent)}
.nav .ico{width:20px;text-align:center}
.sidebar-foot{position:absolute;left:16px;right:16px;bottom:18px}
.main{min-width:0;padding:24px clamp(14px,3vw,38px) 54px}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:20px}
.topbar h1{font-size:25px;margin:0}.eyebrow{color:var(--muted);font-size:12px;margin-top:4px}
.mobile-nav{display:none}
.btn{border:1px solid var(--line);background:var(--panel2);color:var(--text);padding:10px 13px;border-radius:11px;cursor:pointer;font-weight:750}
.btn:hover{border-color:#405171}.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#07101f}
.btn.danger{background:rgba(255,107,122,.12);border-color:rgba(255,107,122,.35);color:#ff9aa5}
.btn.ghost{background:transparent}
.grid-metrics{display:grid;grid-template-columns:repeat(7,minmax(130px,1fr));gap:10px;margin-bottom:18px;overflow-x:auto;padding-bottom:3px}
.metric{min-width:130px;background:linear-gradient(160deg,var(--panel),#11182a);border:1px solid var(--line);border-radius:16px;padding:14px}
.metric .label{color:var(--muted);font-size:11px}.metric .value{font-size:22px;font-weight:900;margin-top:5px}
.card{background:linear-gradient(165deg,rgba(16,22,37,.98),rgba(13,19,33,.98));border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow)}
.section-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:15px}
.section-head h2{margin:0;font-size:19px}
.muted{color:var(--muted);font-size:12px;line-height:1.45}
.hidden{display:none!important}
.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.field{min-width:0}label{display:block;color:var(--muted);font-size:11px;margin:9px 0 5px}
input,select,textarea{width:100%;border:1px solid var(--line);background:#0b1120;color:var(--text);border-radius:11px;padding:10px 11px;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(110,168,254,.10)}
textarea{min-height:120px;resize:vertical}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:13px}
table{width:100%;border-collapse:collapse;font-size:12px;min-width:760px}
th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{position:sticky;top:0;background:#11192a;color:#a9b4c9;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
.status{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:99px;padding:4px 8px;font-size:10px}
.status.active{color:#9bc3ff;border-color:rgba(110,168,254,.35);background:rgba(110,168,254,.08)}
.status.blocked{color:#ff9aa5;border-color:rgba(255,107,122,.35);background:rgba(255,107,122,.08)}
.code-show{font-size:30px;font-weight:950;letter-spacing:.08em;background:linear-gradient(90deg,var(--accent),#b1a7ff);-webkit-background-clip:text;color:transparent;margin:12px 0}
.login{max-width:410px;margin:11vh auto}
.login .logo{width:54px;height:54px;border-radius:17px;margin-bottom:15px}
#toastStack{position:fixed;right:18px;bottom:18px;z-index:1000;display:grid;gap:9px;max-width:min(380px,calc(100vw - 30px))}
.toast{background:#131b2e;border:1px solid #31405d;border-left:4px solid var(--accent);border-radius:13px;padding:12px 13px;box-shadow:var(--shadow);animation:toastIn .2s ease}
.toast.error{border-left-color:var(--danger)}.toast.warn{border-left-color:var(--warning)}
.toast b{display:block;font-size:13px;margin-bottom:2px}.toast span{color:var(--muted);font-size:11px}
@keyframes toastIn{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
.modal-backdrop{position:fixed;inset:0;background:rgba(2,5,12,.72);backdrop-filter:blur(7px);z-index:1100;display:grid;place-items:center;padding:18px}
.modal{width:min(430px,100%);background:#111827;border:1px solid #34415d;border-radius:19px;padding:18px;box-shadow:0 30px 110px rgba(0,0,0,.55)}
.modal h3{margin:0 0 7px}.modal p{color:var(--muted);font-size:13px;line-height:1.5}.modal .actions{justify-content:flex-end}
.mobile-section-title{display:none}
@media(max-width:980px){
  .shell{display:block}.sidebar{display:none}.main{padding:16px 12px 46px}
  .topbar{align-items:flex-start}.topbar h1{font-size:21px}
  .mobile-nav{display:block;margin:12px 0 16px}.mobile-nav select{background:#11192a;font-weight:800}
  .mobile-section-title{display:block;color:var(--muted);font-size:11px;margin-bottom:7px;text-transform:uppercase;letter-spacing:.08em}
  .grid-metrics{grid-template-columns:repeat(7,150px);margin-left:-12px;margin-right:-12px;padding-left:12px;padding-right:12px}
  .card{padding:14px;border-radius:15px;box-shadow:none}.section-head{align-items:flex-start;flex-direction:column}
  .row,.row3{grid-template-columns:1fr}.actions .btn{flex:1 1 140px}
  #toastStack{left:12px;right:12px;bottom:12px;max-width:none}
}
@media(max-width:540px){
  .topbar .btn{padding:8px 10px}.metric{min-width:145px}.card{border-left:0;border-right:0;border-radius:0;margin-left:-12px;margin-right:-12px;padding-left:14px;padding-right:14px}
  .table-wrap{border-left:0;border-right:0;border-radius:0;margin-left:-14px;margin-right:-14px}
  .section-head h2{font-size:18px}
}
</style>
</head>
<body>
<div id="toastStack"></div>

<div id="confirmModal" class="modal-backdrop hidden">
  <div class="modal">
    <h3 id="confirmTitle">Confirmar alteração</h3>
    <p id="confirmText"></p>
    <div class="actions">
      <button class="btn ghost" id="confirmCancel">Cancelar</button>
      <button class="btn primary" id="confirmOk">Confirmar</button>
    </div>
  </div>
</div>

<section id="loginBox" class="login card">
  <div class="logo">OW</div>
  <h2 style="margin:0">Open Wi-Fi Admin</h2>
  <div class="muted" style="margin:5px 0 16px">Gerencie portal, acessos, vendas e eventos.</div>
  <label>Usuário</label><input id="user" value="admin">
  <label>Senha</label><input id="pass" type="password">
  <button class="btn primary" style="width:100%;margin-top:13px" id="login">Entrar</button>
  <div class="muted" id="loginErr" style="margin-top:9px"></div>
</section>

<div id="app" class="shell hidden">
  <aside class="sidebar">
    <div class="brand"><div class="logo">OW</div><div><b>Open Wi-Fi</b><span>Administração</span></div></div>
    <nav class="nav">
      <button data-tab="dash" class="active"><span class="ico">◫</span>Acompanhamento</button>
      <button data-tab="mode"><span class="ico">◉</span>Modo e Evento</button>
      <button data-tab="plans"><span class="ico">▦</span>Produtos e Preços</button>
      <button data-tab="users"><span class="ico">⌁</span>Usuários e Internet</button>
      <button data-tab="portal"><span class="ico">✦</span>Portal</button>
      <button data-tab="codes"><span class="ico">#</span>Códigos</button>
      <button data-tab="groups"><span class="ico">◎</span>Duplas e Grupos</button>
      <button data-tab="audit"><span class="ico">≡</span>Auditoria</button>
    </nav>
    <div class="sidebar-foot"><button class="btn ghost" style="width:100%" id="logoutSide">Sair</button></div>
  </aside>

  <main class="main">
    <div class="topbar">
      <div><h1 id="pageTitle">Acompanhamento</h1><div class="eyebrow">Cloudflare • D1 • MikroTik</div></div>
      <button class="btn ghost" id="logoutTop">Sair</button>
    </div>

    <div class="mobile-nav">
      <div class="mobile-section-title">Seção do painel</div>
      <select id="mobileNav">
        <option value="dash">Acompanhamento</option>
        <option value="mode">Modo e Evento</option>
        <option value="plans">Produtos e Preços</option>
        <option value="users">Usuários e Internet</option>
        <option value="portal">Portal</option>
        <option value="codes">Códigos</option>
        <option value="groups">Duplas e Grupos</option>
        <option value="audit">Auditoria</option>
      </select>
    </div>

    <div class="grid-metrics" id="metrics"></div>

    <section id="dash" class="tab card">
      <div class="section-head"><div><h2>Pagamentos recentes</h2><div class="muted">Últimas movimentações registradas no sistema.</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Plano</th><th>Status</th><th>Valor</th><th>E-mail</th><th>WhatsApp</th><th>Hora</th></tr></thead><tbody id="payments"></tbody></table></div>
    </section>

    <section id="mode" class="tab card hidden">
      <div class="section-head"><div><h2>Modo de utilização</h2><div class="muted">Alterne entre operação padrão e eventos Party.</div></div></div>
      <div class="row">
        <div class="field"><label>Modo ativo</label><select id="modeSel"><option value="standard">Padrão</option><option value="party">Party</option></select></div>
        <div class="field"><label>Vendas</label><select id="sales"><option value="1">Ativas</option><option value="0">Pausadas</option></select></div>
      </div>
      <div class="actions"><button class="btn primary" id="saveMode">Salvar modo</button></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:20px 0">
      <h3 style="margin:0 0 4px">Evento Party</h3><div class="muted">Os planos configurados até o fim do evento usam este horário.</div>
      <label>Nome do evento</label><input id="eventName">
      <div class="row"><div><label>Início</label><input id="eventStart" type="datetime-local"></div><div><label>Fim</label><input id="eventEnd" type="datetime-local"></div></div>
      <div class="actions"><button class="btn primary" id="saveEvent">Salvar evento</button></div>
    </section>

    <section id="plans" class="tab card hidden">
      <div class="section-head"><div><h2>Produtos e preços</h2><div class="muted">Crie planos diferentes para cada modo de operação.</div></div><button class="btn primary" id="newPlan">Novo produto</button></div>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>Modo</th><th>Preço</th><th>Duração</th><th>Disp.</th><th>Status</th><th>Ação</th></tr></thead><tbody id="plansRows"></tbody></table></div>
      <div id="planForm" class="hidden" style="margin-top:18px">
        <input id="planId" type="hidden">
        <div class="row3"><div><label>Nome</label><input id="planName"></div><div><label>Slug</label><input id="planSlug"></div><div><label>Modo</label><select id="planMode"><option value="standard">Padrão</option><option value="party">Party</option><option value="both">Ambos</option></select></div></div>
        <div class="row3"><div><label>Preço R$</label><input id="planPrice" type="number" step=".01"></div><div><label>Duração min</label><input id="planMinutes" type="number"></div><div><label>Máx. dispositivos</label><input id="planMax" type="number"></div></div>
        <label><input id="planEventEnd" type="checkbox" style="width:auto"> válido até o fim do evento</label>
        <label><input id="planEnabled" type="checkbox" style="width:auto" checked> produto ativo</label>
        <div class="actions"><button class="btn primary" id="savePlan">Salvar produto</button><button class="btn ghost" id="cancelPlan">Cancelar</button></div>
      </div>
    </section>

    <section id="users" class="tab card hidden">
      <div class="section-head">
        <div>
          <h2>Usuários e Internet</h2>
          <div class="muted">“Encerrar acesso” desconecta o usuário e revoga o acesso atual. Para entrar novamente, ele precisará de uma nova compra ou de um novo código.</div>
        </div>
        <button class="btn" id="reloadUsers">Atualizar</button>
      </div>
      <div class="row">
        <div>
          <label>Motivo / observação</label>
          <input id="revokeReason" value="Acesso encerrado manualmente pelo administrador" maxlength="180">
        </div>
        <div>
          <label>Selecionados</label>
          <div class="actions" style="margin-top:0">
            <button class="btn danger" id="revokeSelected">Encerrar acesso selecionados</button>
          </div>
        </div>
      </div>
      <div class="muted" id="selectionCount" style="margin:10px 0">0 selecionados</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th><input id="selectAllUsers" type="checkbox" style="width:auto"></th><th>Usuário</th><th>MAC</th><th>Último contato</th><th>Acesso atual</th><th>Status</th><th>Ação</th></tr></thead>
          <tbody id="usersRows"></tbody>
        </table>
      </div>
    </section>

    <section id="portal" class="tab card hidden">
      <div class="section-head"><div><h2>Captive Portal</h2><div class="muted">Personalize o que o usuário encontra ao entrar na rede.</div></div></div>
      <div class="row"><div><label>Título</label><input id="portalTitle"></div><div><label>WhatsApp de suporte</label><input id="supportWhatsapp"></div></div>
      <label>Subtítulo</label><input id="portalSubtitle">
      <div class="row"><div><label>Título do “Conheça-nos”</label><input id="aboutTitle"></div><div><label>Background</label><select id="bgMode"><option value="gradient">Sem imagem</option><option value="image">Com imagem</option></select></div></div>
      <label>Texto do “Conheça-nos”</label><textarea id="aboutText"></textarea>
      <label>URL HTTPS da imagem de fundo</label><input id="bgUrl" placeholder="https://...">
      <label><input id="requireWhatsappStandard" type="checkbox" style="width:auto"> exigir WhatsApp também no modo Padrão</label>
      <div class="actions"><button class="btn primary" id="savePortal">Salvar portal</button></div>
    </section>

    <section id="codes" class="tab card hidden">
      <div class="section-head"><div><h2>Códigos de acesso</h2><div class="muted">O código é de uso único. Você decide quanto tempo de internet ele libera.</div></div></div>
      <div class="row3">
        <div><label>Tipo de acesso</label><select id="codeAccessType"><option value="minutes">Por minutos</option><option value="permanent">Permanente</option></select></div>
        <div id="codeMinutesWrap"><label>Tempo de internet (minutos)</label><input id="codeMinutes" type="number" min="1" value="60"></div>
        <div style="display:flex;align-items:end"><button class="btn primary" style="width:100%" id="genCode">Gerar código</button></div>
      </div>
      <div id="newCodeBox" class="hidden" style="margin-top:16px;padding:15px;border:1px solid var(--line);border-radius:14px;background:#0b1120">
        <div class="muted">Novo código</div><div class="code-show" id="newCode"></div><div class="muted" id="newCodeInfo"></div>
        <div class="actions"><button class="btn" id="copyNewCode">Copiar código</button></div>
      </div>
      <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Código</th><th>Modo em que foi criado</th><th>Acesso concedido</th><th>Status</th><th>Uso</th></tr></thead><tbody id="codesRows"></tbody></table></div>
    </section>

    <section id="groups" class="tab card hidden">
      <div class="section-head"><div><h2>Duplas e grupos</h2><div class="muted">Acompanhe ocupação e recupere o link do representante.</div></div><input id="groupPhone" style="max-width:260px" placeholder="Buscar WhatsApp"></div>
      <div class="table-wrap"><table><thead><tr><th>Código</th><th>WhatsApp</th><th>Ocupação</th><th>Expira</th><th>Representante</th></tr></thead><tbody id="groupsRows"></tbody></table></div>
    </section>

    <section id="audit" class="tab card hidden">
      <div class="section-head"><div><h2>Auditoria</h2><div class="muted">Registro das alterações feitas no painel.</div></div></div>
      <div id="auditRows"></div>
    </section>
  </main>
</div>

<script>
const $=id=>document.getElementById(id);
let state=null,plans=[],adminUsers=[],confirmResolve=null,lastGeneratedCode="";

const titles={
  dash:"Acompanhamento",mode:"Modo e Evento",plans:"Produtos e Preços",
  users:"Usuários e Internet",portal:"Captive Portal",codes:"Códigos de Acesso",
  groups:"Duplas e Grupos",audit:"Auditoria"
};

async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{"content-type":"application/json",...(opt.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(d.error||"Erro");e.data=d;throw e}
  return d;
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m]))}
function brl(c){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format((c||0)/100)}
function dt(v){return v?new Date(Number(v)).toLocaleString("pt-BR"):"—"}
function localInput(v){if(!v)return"";const d=new Date(Number(v)),z=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"T"+z(d.getHours())+":"+z(d.getMinutes())}
function durationLabel(seconds,permanent){if(permanent)return"Permanente";const s=Number(seconds||0);if(!s)return"Legado";if(s<3600)return Math.round(s/60)+" min";if(s%3600===0)return (s/3600)+" h";return Math.round(s/60)+" min"}

function toast(title,text="",type="ok"){
  const box=document.createElement("div");
  box.className="toast "+(type==="error"?"error":type==="warn"?"warn":"");
  box.innerHTML="<b>"+esc(title)+"</b>"+(text?"<span>"+esc(text)+"</span>":"");
  $("toastStack").appendChild(box);
  setTimeout(()=>box.remove(),3500);
}

function ask(title,text,confirmLabel="Confirmar",danger=false){
  $("confirmTitle").textContent=title;
  $("confirmText").textContent=text;
  $("confirmOk").textContent=confirmLabel;
  $("confirmOk").className="btn "+(danger?"danger":"primary");
  $("confirmModal").classList.remove("hidden");
  return new Promise(resolve=>{confirmResolve=resolve});
}
function closeAsk(result){
  $("confirmModal").classList.add("hidden");
  if(confirmResolve){const r=confirmResolve;confirmResolve=null;r(result)}
}
$("confirmCancel").onclick=()=>closeAsk(false);
$("confirmOk").onclick=()=>closeAsk(true);
$("confirmModal").onclick=e=>{if(e.target===$("confirmModal"))closeAsk(false)};

function switchTab(id){
  document.querySelectorAll(".tab").forEach(x=>x.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));
  $("mobileNav").value=id;
  $("pageTitle").textContent=titles[id]||"Open Wi-Fi";
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$("mobileNav").onchange=e=>switchTab(e.target.value);

async function boot(){
  try{
    state=await api("/api/admin/dashboard");
    $("loginBox").classList.add("hidden");
    $("app").classList.remove("hidden");
    renderDash();
    await Promise.all([loadPlans(),loadUsers(),loadCodes(),loadGroups(),loadAudit()]);
  }catch{
    $("loginBox").classList.remove("hidden");
    $("app").classList.add("hidden");
  }
}

$("login").onclick=async()=>{
  $("loginErr").textContent="";
  try{
    await api("/api/admin/login",{method:"POST",body:JSON.stringify({user:$("user").value,password:$("pass").value})});
    toast("Login efetuado","Bem-vindo ao painel.");
    await boot();
  }catch{$("loginErr").textContent="Usuário ou senha inválidos."}
};

async function logout(){
  await api("/api/admin/logout",{method:"POST"});
  location.reload();
}
$("logoutSide").onclick=logout;$("logoutTop").onclick=logout;

function renderDash(){
  const m=state.metrics;
  $("metrics").innerHTML=[
    ["RB",m.routerOnline?"ONLINE":"OFFLINE"],
    ["Clientes",m.routerHostCount],
    ["Vendas hoje",m.paidToday],
    ["Receita",brl(m.revenueTodayCents)],
    ["Acessos",m.activeGrants],
    ["Pix pendentes",m.pendingPayments],
    ["Tentativas 30s",m.activeAttempts]
  ].map(x=>"<div class='metric'><div class='label'>"+x[0]+"</div><div class='value'>"+x[1]+"</div></div>").join("");

  $("payments").innerHTML=state.recentPayments.map(p=>"<tr><td>"+esc(p.plan_name)+"</td><td>"+esc(p.status)+"</td><td>"+brl(p.amount_cents)+"</td><td>"+esc(p.payer_email||"—")+"</td><td>"+esc(p.phone_e164||"—")+"</td><td>"+dt(p.created_at)+"</td></tr>").join("");

  $("modeSel").value=state.site.mode;
  $("sales").value=state.site.sales_enabled?"1":"0";
  $("portalTitle").value=state.site.portal_title||"";
  $("portalSubtitle").value=state.site.portal_subtitle||"";
  $("supportWhatsapp").value=state.site.support_whatsapp||"";
  $("requireWhatsappStandard").checked=!!state.site.require_whatsapp_standard;
  $("bgMode").value=state.site.background_mode||"gradient";
  $("bgUrl").value=state.site.background_image_url||"";
  $("aboutTitle").value=state.site.about_title||"Conheça o Open Wi-Fi";
  $("aboutText").value=state.site.about_text||"";
  if(state.event){
    $("eventName").value=state.event.name||"";
    $("eventStart").value=localInput(state.event.starts_at);
    $("eventEnd").value=localInput(state.event.ends_at);
  }
}

async function saveConfig(source){
  const ok=await ask("Salvar alterações?","As novas configurações ficarão disponíveis no portal imediatamente.","Salvar");
  if(!ok)return;
  await api("/api/admin/config",{method:"PUT",body:JSON.stringify({
    mode:$("modeSel").value,
    salesEnabled:$("sales").value==="1",
    backgroundMode:$("bgMode").value,
    backgroundImageUrl:$("bgUrl").value,
    supportWhatsapp:$("supportWhatsapp").value,
    requireWhatsappStandard:$("requireWhatsappStandard").checked,
    portalTitle:$("portalTitle").value,
    portalSubtitle:$("portalSubtitle").value,
    aboutTitle:$("aboutTitle").value,
    aboutText:$("aboutText").value
  })});
  toast("Alterações salvas",source==="portal"?"O captive portal foi atualizado.":"O modo de operação foi atualizado.");
  await boot();
}
$("saveMode").onclick=()=>saveConfig("mode");
$("savePortal").onclick=()=>saveConfig("portal");

$("saveEvent").onclick=async()=>{
  const ok=await ask("Salvar evento?","Nome e horários do evento serão atualizados.","Salvar evento");
  if(!ok)return;
  try{
    await api("/api/admin/event",{method:"PUT",body:JSON.stringify({
      name:$("eventName").value,
      startsAt:new Date($("eventStart").value).getTime(),
      endsAt:new Date($("eventEnd").value).getTime()
    })});
    toast("Evento atualizado","As novas datas foram salvas.");
    await boot();
  }catch(e){toast("Não foi possível salvar",e.message,"error")}
};

async function loadPlans(){
  const d=await api("/api/admin/plans");plans=d.plans;
  $("plansRows").innerHTML=plans.map(p=>"<tr><td><b>"+esc(p.name)+"</b></td><td>"+esc(p.mode)+"</td><td>"+brl(p.price_cents)+"</td><td>"+(p.party_until_event_end?"Fim do evento":durationLabel(p.duration_seconds,false))+"</td><td>"+p.max_devices+"</td><td><span class='status "+(p.enabled?"active":"blocked")+"'>"+(p.enabled?"ATIVO":"INATIVO")+"</span></td><td><button class='btn' onclick='editPlan("+JSON.stringify(p.id)+")'>Editar</button> <button class='btn danger' onclick='delPlan("+JSON.stringify(p.id)+")'>Excluir</button></td></tr>").join("");
}
window.editPlan=id=>{
  const p=plans.find(x=>x.id===id);if(!p)return;
  $("planForm").classList.remove("hidden");$("planId").value=p.id;$("planName").value=p.name;$("planSlug").value=p.slug;$("planMode").value=p.mode;$("planPrice").value=(p.price_cents/100).toFixed(2);$("planMinutes").value=p.duration_seconds?Math.round(p.duration_seconds/60):60;$("planMax").value=p.max_devices;$("planEventEnd").checked=!!p.party_until_event_end;$("planEnabled").checked=!!p.enabled;
};
$("newPlan").onclick=()=>{$("planForm").classList.remove("hidden");$("planId").value="";$("planName").value="";$("planSlug").value="";$("planMode").value="standard";$("planPrice").value="2.00";$("planMinutes").value="60";$("planMax").value="1";$("planEventEnd").checked=false;$("planEnabled").checked=true};
$("cancelPlan").onclick=()=>$("planForm").classList.add("hidden");
$("savePlan").onclick=async()=>{
  const id=$("planId").value;
  const ok=await ask(id?"Salvar alterações do produto?":"Criar novo produto?","Preço, duração e disponibilidade serão usados no captive portal.",id?"Salvar":"Criar");
  if(!ok)return;
  try{
    await api("/api/admin/plans"+(id?"/"+id:""),{
      method:id?"PUT":"POST",
      body:JSON.stringify({
        name:$("planName").value,slug:$("planSlug").value,mode:$("planMode").value,
        priceCents:Math.round(Number($("planPrice").value)*100),
        durationSeconds:Number($("planMinutes").value)*60,
        maxDevices:Number($("planMax").value),
        partyUntilEventEnd:$("planEventEnd").checked,
        enabled:$("planEnabled").checked
      })
    });
    $("planForm").classList.add("hidden");
    toast(id?"Produto atualizado":"Produto criado","Alteração aplicada ao catálogo.");
    await loadPlans();
  }catch(e){toast("Erro no produto",e.message,"error")}
};
window.delPlan=async id=>{
  const ok=await ask("Excluir produto?","Se já houver vendas, ele será apenas desativado para preservar o histórico.","Excluir",true);
  if(!ok)return;
  try{await api("/api/admin/plans/"+id,{method:"DELETE"});toast("Produto atualizado","Exclusão/desativação concluída.");await loadPlans()}
  catch(e){toast("Erro ao excluir",e.message,"error")}
};

function selectedUserIds(){return [...document.querySelectorAll(".userSelect:checked")].map(x=>x.value)}
function updateSelectionCount(){const n=selectedUserIds().length;$("selectionCount").textContent=n+" selecionado"+(n===1?"":"s")}

async function loadUsers(){
  const d=await api("/api/admin/users");
  adminUsers=d.users;

  $("usersRows").innerHTML=adminUsers.map(u=>{
    const who=u.hostname||u.payer_email||u.phone_e164||u.id.slice(0,8);
    const contact=[u.payer_email,u.phone_e164].filter(Boolean).map(esc).join("<br>");
    const macs=(u.macs||[]).map(esc).join("<br>")||"—";
    const active=!!u.active_until && u.active_until>Date.now();
    const access=active?"até "+dt(u.active_until):"nenhum acesso válido";
    const status=active
      ?"<span class='status active'>CONECTÁVEL</span>"
      :"<span class='status'>SEM ACESSO</span>";
    const action=active
      ?"<button class='btn danger' onclick='revokeOneUser("+JSON.stringify(u.id)+")'>Encerrar acesso</button>"
      :"<span class='muted'>—</span>";

    return "<tr>"+
      "<td><input class='userSelect' type='checkbox' style='width:auto' value='"+esc(u.id)+"'></td>"+
      "<td><b>"+esc(who)+"</b><br><span class='muted'>"+contact+"</span></td>"+
      "<td>"+macs+"</td>"+
      "<td>"+dt(u.last_seen_at)+"</td>"+
      "<td>"+access+"</td>"+
      "<td>"+status+"</td>"+
      "<td>"+action+"</td>"+
    "</tr>";
  }).join("");

  document.querySelectorAll(".userSelect").forEach(x=>x.onchange=updateSelectionCount);
  $("selectAllUsers").checked=false;
  updateSelectionCount();
}

$("reloadUsers").onclick=async()=>{await loadUsers();toast("Lista atualizada")};

$("selectAllUsers").onchange=()=>{
  document.querySelectorAll(".userSelect").forEach(x=>x.checked=$("selectAllUsers").checked);
  updateSelectionCount();
};

async function revokeUsers(ids){
  if(!ids.length){
    toast("Nenhum usuário selecionado","Marque pelo menos um usuário.","warn");
    return;
  }

  const ok=await ask(
    "Encerrar acesso?",
    "O acesso atual de "+ids.length+" usuário(s) será revogado e a MikroTik derrubará a conexão no próximo sincronismo. Para voltar, será necessária uma nova compra ou um novo código.",
    "Encerrar acesso",
    true
  );
  if(!ok)return;

  try{
    const d=await api("/api/admin/users/revoke",{
      method:"POST",
      body:JSON.stringify({
        deviceIds:ids,
        reason:$("revokeReason").value
      })
    });

    toast(
      "Acesso encerrado",
      d.grantsRevoked+" acesso(s) revogado(s)."
    );

    await Promise.all([loadUsers(),boot()]);
  }catch(e){
    toast("Erro ao encerrar acesso",e.message,"error");
  }
}

window.revokeOneUser=id=>revokeUsers([id]);
$("revokeSelected").onclick=()=>revokeUsers(selectedUserIds());

async function loadCodes(){
  const d=await api("/api/admin/codes");
  $("codesRows").innerHTML=d.codes.map(c=>{
    const access=durationLabel(c.duration_seconds,!!c.is_permanent);
    const use=c.redeemed_at?"Usado em "+dt(c.redeemed_at):"Ainda não utilizado";
    return "<tr><td><b>"+esc(c.code)+"</b></td><td>"+esc(c.mode)+"</td><td>"+access+"</td><td><span class='status "+(c.status==="active"?"active":"blocked")+"'>"+esc(c.status.toUpperCase())+"</span></td><td>"+use+"</td></tr>";
  }).join("");
}
$("genCode").onclick=async()=>{
  const permanent=$("codeAccessType").value==="permanent";
  const minutes=Number($("codeMinutes").value);
  if(!permanent&&(!Number.isFinite(minutes)||minutes<1)){toast("Tempo inválido","Informe pelo menos 1 minuto.","warn");return}
  const description=permanent?"O acesso concedido por este código não terá expiração automática.":"O código concederá "+Math.round(minutes)+" minuto(s) de internet.";
  const ok=await ask("Gerar código de acesso?",description,"Gerar código");
  if(!ok)return;
  try{
    const d=await api("/api/admin/codes",{method:"POST",body:JSON.stringify({accessType:permanent?"permanent":"minutes",minutes})});
    lastGeneratedCode=d.code;
    $("newCode").textContent=d.code;
    $("newCodeInfo").textContent=d.permanent?"Acesso permanente":"Acesso por "+d.minutes+" minuto(s)";
    $("newCodeBox").classList.remove("hidden");
    toast("Código gerado","Pronto para ser entregue ao usuário.");
    await loadCodes();
  }catch(e){toast("Erro ao gerar código",e.message,"error")}
};
$("copyNewCode").onclick=async()=>{if(lastGeneratedCode){await navigator.clipboard.writeText(lastGeneratedCode);toast("Código copiado")}};

async function loadGroups(){
  const q=$("groupPhone").value?"?phone="+encodeURIComponent($("groupPhone").value):"";
  const d=await api("/api/admin/groups"+q);
  $("groupsRows").innerHTML=d.groups.map(g=>"<tr><td><b>"+esc(g.code)+"</b></td><td>"+esc(g.phone_e164||"—")+"</td><td>"+g.used_devices+" / "+g.max_devices+"</td><td>"+dt(g.expires_at)+"</td><td><button class='btn' onclick='copyGroupLink("+JSON.stringify(g.public_url)+")'>Copiar link</button></td></tr>").join("");
}
window.copyGroupLink=async link=>{await navigator.clipboard.writeText(link);toast("Link copiado","Envie ao representante do grupo.")};
$("groupPhone").oninput=()=>{clearTimeout(window.gt);window.gt=setTimeout(loadGroups,300)};

async function loadAudit(){
  const d=await api("/api/admin/audit");
  $("auditRows").innerHTML=d.audit.map(a=>"<div style='padding:11px 0;border-bottom:1px solid var(--line)'><b>"+esc(a.action)+"</b><div class='muted'>"+dt(a.created_at)+" • "+esc(a.details_json||"")+"</div></div>").join("");
}

boot();
setInterval(async()=>{
  if(!$("app").classList.contains("hidden")){
    try{state=await api("/api/admin/dashboard");renderDash()}catch{}
  }
},10000);
</script>
</body>
</html>`;
}
// ============================================================
// PORTAL HTML
// ============================================================

function portalPage(env) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Open Wi-Fi</title>
<style>
:root{
  color-scheme:dark;
  --bg:#090d18;
  --card:#111827;
  --card2:#151f34;
  --line:#2a3854;
  --text:#f4f7ff;
  --muted:#98a6c1;
  --accent:#6ea8fe;
  --accent2:#8b7cf6;
  --danger:#ff7583;
}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;background:
radial-gradient(circle at 90% -10%,rgba(139,124,246,.24),transparent 35%),
radial-gradient(circle at 0 20%,rgba(110,168,254,.18),transparent 34%),
linear-gradient(180deg,#090d18,#0d1322);background-size:cover;background-position:center}
body:before{content:"";position:fixed;inset:0;background:rgba(5,8,16,.18);z-index:-1}
.wrap{max-width:510px;margin:auto;padding:22px 15px 42px}
.brand{text-align:center;padding:8px 0 22px}
.logo{width:68px;height:68px;border-radius:21px;margin:0 auto 11px;display:grid;place-items:center;background:linear-gradient(145deg,var(--accent),var(--accent2));color:#07101f;font-size:24px;font-weight:950;box-shadow:0 18px 50px rgba(72,104,200,.22)}
h1{font-size:26px;margin:0}.muted{color:var(--muted);font-size:13px;line-height:1.5}
.card{background:rgba(17,24,39,.94);border:1px solid var(--line);border-radius:20px;padding:17px;margin-bottom:12px;box-shadow:0 20px 60px rgba(0,0,0,.28);backdrop-filter:blur(12px)}
.title{font-size:18px;font-weight:900;margin-bottom:5px}
.option-grid{display:grid;gap:10px}
.option{width:100%;display:flex;align-items:center;gap:13px;text-align:left;border:1px solid var(--line);background:linear-gradient(145deg,#151f34,#101827);color:var(--text);padding:15px;border-radius:16px;cursor:pointer}
.option .icon{flex:0 0 43px;height:43px;border-radius:13px;display:grid;place-items:center;background:rgba(110,168,254,.12);border:1px solid rgba(110,168,254,.20);font-size:19px}
.option b{display:block;font-size:15px}.option span{display:block;color:var(--muted);font-size:11px;margin-top:3px;line-height:1.4}
.plans{display:grid;gap:9px;margin-top:12px}
.plan{width:100%;border:1px solid var(--line);background:var(--card2);color:var(--text);border-radius:15px;padding:13px;display:flex;justify-content:space-between;gap:12px;text-align:left}
.price{color:#a8c9ff;font-weight:950;font-size:17px}
label{display:block;color:var(--muted);font-size:11px;margin:9px 0 4px}
input{width:100%;border:1px solid var(--line);background:#0a1020;color:var(--text);border-radius:12px;padding:11px}
.btn{width:100%;border:1px solid var(--line);background:#17233a;color:var(--text);border-radius:12px;padding:11px;margin-top:8px;font-weight:850}
.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));border-color:transparent;color:#07101f}
.btn.back{background:transparent;color:var(--muted)}
.hidden{display:none!important}.center{text-align:center}
.qr{width:min(270px,80vw);background:#fff;padding:8px;border-radius:14px;margin:12px auto}
.codebig{font-size:29px;color:#a8c9ff;font-weight:950;letter-spacing:.08em}
.badge{display:inline-flex;border:1px solid var(--line);border-radius:99px;padding:4px 8px;font-size:10px;color:#a8c9ff;background:rgba(110,168,254,.08)}
.notice{padding:11px 12px;border-radius:12px;background:rgba(110,168,254,.07);border:1px solid rgba(110,168,254,.18);color:#b9c9e5;font-size:12px;line-height:1.45}
.error{color:#ff9ba5;font-size:12px;margin-top:7px}
.about{white-space:pre-wrap;color:#c8d3e7;font-size:13px;line-height:1.65}
@media(max-width:520px){.wrap{padding:16px 12px 32px}.brand{padding-top:4px}.card{border-radius:17px;padding:15px}.option{padding:14px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="logo">OW</div>
    <h1 id="brandTitle">Open Wi-Fi</h1>
    <div class="muted" id="brandSub">Carregando...</div>
  </div>

  <section class="card" id="loading">
    <div class="title">Preparando seu acesso</div>
    <div class="muted" id="loadingText">Identificando este aparelho...</div>
  </section>

  <section class="card hidden" id="homeBox">
    <div class="title">O que você deseja fazer?</div>
    <div class="muted" id="homeContext" style="margin-bottom:13px"></div>
    <div class="option-grid">
      <button class="option" id="goAccess">
        <div class="icon">⌁</div>
        <div><b>Liberar internet</b><span>Veja os planos disponíveis e faça a liberação pelo Pix.</span></div>
      </button>
      <button class="option" id="goCode">
        <div class="icon">#</div>
        <div><b>Possui um código?</b><span>Use um código de acesso ou, no Party, o código da sua dupla/grupo.</span></div>
      </button>
      <button class="option" id="goAbout">
        <div class="icon">i</div>
        <div><b>Conheça-nos</b><span>Entenda como o Open Wi-Fi funciona e o objetivo do serviço.</span></div>
      </button>
    </div>
  </section>

  <section class="card hidden" id="plansBox">
    <div class="title" id="modeTitle">Planos disponíveis</div>
    <div class="muted" id="eventText"></div>
    <div class="plans" id="plans"></div>
    <button class="btn back" data-home>Voltar ao início</button>
  </section>

  <section class="card hidden" id="aboutBox">
    <div class="title" id="aboutTitle">Conheça o Open Wi-Fi</div>
    <div class="about" id="aboutText"></div>
    <button class="btn back" data-home>Voltar ao início</button>
  </section>

  <section class="card hidden" id="codeBox">
    <div class="title">Possui um código?</div>
    <div class="muted">Digite o código recebido. No modo Party, códigos de Dupla/Grupo também são reconhecidos aqui.</div>
    <label>Código</label><input id="codeInput" maxlength="16" autocomplete="off" autocapitalize="characters">
    <button class="btn primary" id="redeemCode">Liberar com código</button>
    <button class="btn back" data-home>Voltar ao início</button>
    <div class="error" id="codeErr"></div>
  </section>

  <section class="card hidden" id="checkoutBox">
    <div class="title" id="checkoutTitle"></div>
    <div class="muted" id="checkoutSub"></div>
    <label>E-mail</label><input id="email" type="email" inputmode="email">
    <label>WhatsApp</label><input id="phone" inputmode="tel" placeholder="(17) 99999-9999">
    <div class="muted" id="phoneHint" style="margin-top:5px"></div>
    <button class="btn primary" id="createPix">Gerar Pix</button>
    <button class="btn back" id="backPlans">Voltar aos planos</button>
    <div class="error" id="checkoutError"></div>
  </section>

  <section class="card hidden center" id="pixBox">
    <div class="title">Pague com Pix</div>
    <div class="muted" id="pixPlan"></div>
    <img class="qr" id="qr">
    <label style="text-align:left">Pix Copia e Cola</label>
    <input id="pixCode" readonly>
    <button class="btn primary" id="copyPix">Copiar Pix</button>
    <div id="payStatus" style="margin-top:11px;font-weight:850">Aguardando pagamento...</div>
    <div class="notice" style="margin-top:12px">O QR continua válido mesmo se a janela temporária terminar.</div>
    <button class="btn" id="startAttempt">Liberar internet por 30 s</button>
    <div class="muted" id="attemptInfo" style="margin-top:6px"></div>
  </section>

  <section class="card hidden center" id="successBox">
    <div style="font-size:39px">✓</div>
    <div class="title">Acesso liberado</div>
    <div class="muted" id="successText"></div>
    <div id="groupSuccess" class="hidden">
      <div style="margin-top:15px"><span class="badge">DUPLA / GRUPO</span></div>
      <div class="muted" style="margin-top:10px">Código para os participantes</div>
      <div class="codebig" id="groupCode"></div>
      <button class="btn" id="copyGroupCode">Copiar código</button>
      <button class="btn" id="copyGroupLink">Copiar link de acompanhamento</button>
    </div>
  </section>

  <div class="muted center" id="support"></div>
</div>

<script>
const q=new URLSearchParams(location.search);
const siteId=q.get("site")||"openwifi-main";
const mac=(q.get("mac")||"").toUpperCase();
const ip=q.get("ip")||"";
const KEY="openwifi_device_id_v1";
let deviceId=localStorage.getItem(KEY)||crypto.randomUUID();
localStorage.setItem(KEY,deviceId);
let selectedPlan,currentPayment,pollTimer,siteData,currentGroup;

const $=id=>document.getElementById(id);
const show=id=>$(id).classList.remove("hidden");
const hide=id=>$(id).classList.add("hidden");
const brl=c=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(c/100);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m]));

async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{"content-type":"application/json",...(opt.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(d.error||"Erro");e.data=d;throw e}
  return d;
}

function dur(p){
  if(p.party_until_event_end)return"Até o fim do evento";
  const s=Number(p.duration_seconds||0);
  if(s===3600)return"1 hora";
  if(s===86400)return"1 dia";
  if(s===604800)return"1 semana";
  if(s===2592000)return"30 dias";
  if(s<3600)return Math.round(s/60)+" min";
  return Math.round(s/3600)+" h";
}

function showOnly(id){
  ["homeBox","plansBox","aboutBox","codeBox","checkoutBox","pixBox","successBox"].forEach(x=>hide(x));
  show(id);
}

function applySite(d){
  $("brandTitle").textContent=d.site.portalTitle;
  $("brandSub").textContent=d.site.portalSubtitle;
  $("aboutTitle").textContent=d.site.aboutTitle||"Conheça o Open Wi-Fi";
  $("aboutText").textContent=d.site.aboutText||"";
  $("modeTitle").textContent=d.site.mode==="party"?"Planos do evento":"Planos disponíveis";
  $("eventText").textContent=d.event?d.event.name+" • até "+new Date(d.event.ends_at).toLocaleString("pt-BR"):"";
  $("homeContext").textContent=d.site.mode==="party"?(d.event?d.event.name+" • Modo Party":"Modo Party"):"Modo Padrão";
  $("support").textContent=d.site.supportWhatsapp?"Suporte WhatsApp: +"+d.site.supportWhatsapp:"";
  if(d.site.backgroundMode==="image"&&d.site.backgroundImageUrl){
    document.body.style.backgroundImage="linear-gradient(rgba(5,8,16,.62),rgba(5,8,16,.72)),url('"+d.site.backgroundImageUrl.replace(/'/g,"")+"')";
  }
}

async function boot(){
  if(!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)){
    $("loadingText").textContent="Abra esta página pela rede Open Wi-Fi.";
    return;
  }
  try{
    const reg=await api("/api/device/register",{method:"POST",body:JSON.stringify({siteId,mac,ip,deviceId})});
    deviceId=reg.deviceId;
    localStorage.setItem(KEY,deviceId);

    if(reg.activeUntil>Date.now()){
      hide("loading");show("successBox");
      $("successText").textContent="Este aparelho já possui acesso ativo até "+new Date(reg.activeUntil).toLocaleString("pt-BR")+".";
      return;
    }

    const d=await api("/api/plans?site="+encodeURIComponent(siteId));
    siteData=d;applySite(d);renderPlans(d.plans);
    hide("loading");show("homeBox");
  }catch(e){
    $("loadingText").textContent=e.message;
  }
}

function renderPlans(ps){
  $("plans").innerHTML=ps.map(p=>
    "<button class='plan' data-id='"+esc(p.id)+"'><span><b>"+esc(p.name)+"</b><br><small>"+dur(p)+(p.max_devices>1?" • "+p.max_devices+" dispositivos":"")+"</small></span><span class='price'>"+brl(p.price_cents)+"</span></button>"
  ).join("");
  document.querySelectorAll(".plan").forEach(b=>b.onclick=()=>choosePlan(ps.find(p=>p.id===b.dataset.id)));
}

$("goAccess").onclick=()=>showOnly("plansBox");
$("goCode").onclick=()=>{showOnly("codeBox");$("codeInput").value="";$("codeErr").textContent=""};
$("goAbout").onclick=()=>showOnly("aboutBox");
document.querySelectorAll("[data-home]").forEach(b=>b.onclick=()=>showOnly("homeBox"));

function choosePlan(p){
  selectedPlan=p;
  $("checkoutTitle").textContent=p.name+" • "+brl(p.price_cents);
  $("checkoutSub").textContent=dur(p)+(p.max_devices>1?" • "+p.max_devices+" dispositivos":"");
  $("phoneHint").textContent=(siteData.site.mode==="party"||siteData.site.requireWhatsappStandard)?"WhatsApp obrigatório.":"WhatsApp opcional.";
  showOnly("checkoutBox");
}
$("backPlans").onclick=()=>showOnly("plansBox");

$("redeemCode").onclick=async()=>{
  $("codeErr").textContent="";
  const payload={siteId,deviceId,mac,code:$("codeInput").value};
  try{
    const d=await api("/api/access-code/redeem",{method:"POST",body:JSON.stringify(payload)});
    showOnly("successBox");
    $("successText").textContent=d.permanent?"Código aceito. Acesso permanente liberado.":"Código aceito. Acesso liberado até "+new Date(d.access.ends_at).toLocaleString("pt-BR")+".";
    return;
  }catch(e){
    if(e.data?.error!=="access_code_not_found"){
      $("codeErr").textContent=e.data?.reason||e.message;
      return;
    }
  }

  // Se não for código administrativo, tenta automaticamente um código de Dupla/Grupo.
  try{
    const d=await api("/api/group/join",{method:"POST",body:JSON.stringify(payload)});
    showOnly("successBox");
    $("successText").textContent="Código de grupo aceito. Internet liberada.";
    if(d.group)showGroup(d.group);
  }catch(e){
    $("codeErr").textContent="Código não encontrado, expirado ou sem vagas.";
  }
};

$("createPix").onclick=async()=>{
  $("checkoutError").textContent="";
  try{
    const d=await api("/api/payments/create",{method:"POST",body:JSON.stringify({
      siteId,deviceId,planId:selectedPlan.id,mac,ip,
      email:$("email").value,phone:$("phone").value
    })});
    currentPayment=d.payment;
    showOnly("pixBox");
    $("pixPlan").textContent=d.payment.planName+" • "+brl(d.payment.amountCents);
    $("pixCode").value=d.payment.qrCode||"";
    if(d.payment.qrCodeBase64)$("qr").src="data:image/png;base64,"+d.payment.qrCodeBase64;
    renderAttempt(null);
    startPolling(d.payment.id);
  }catch(e){
    $("checkoutError").textContent=e.data?.reason||e.message;
  }
};

$("copyPix").onclick=async()=>{
  try{await navigator.clipboard.writeText($("pixCode").value);$("copyPix").textContent="Pix copiado ✓";setTimeout(()=>$("copyPix").textContent="Copiar Pix",1400)}catch{}
};

function renderAttempt(a){
  const now=Date.now(),btn=$("startAttempt"),info=$("attemptInfo");

  info.style.color="";

  if(!a){
    btn.disabled=false;
    btn.textContent="Liberar internet por 30 s";
    info.textContent="";
    return;
  }

  if(a.waitingRouter){
    btn.disabled=true;
    btn.textContent="Liberando...";
    info.textContent="Aguardando a MikroTik. Os 30 segundos ainda não começaram.";
    return;
  }

  if(a.activeUntil>now){
    btn.disabled=true;
    btn.textContent="Internet temporária ativa";
    info.textContent="Tentativa "+a.activeAttemptNumber+"/"+a.maxAttempts+" • "+Math.max(0,Math.ceil((a.activeUntil-now)/1000))+" s restantes";
    return;
  }

  if(a.cooldownUntil>now){
    btn.disabled=true;
    btn.textContent="Aguarde";
    info.textContent="Novas tentativas em "+Math.ceil((a.cooldownUntil-now)/1000)+" s";
    return;
  }

  btn.disabled=false;
  btn.textContent="Liberar internet por 30 s";
  info.textContent=a.attemptsUsed+"/"+a.maxAttempts+" tentativas usadas";
}

$("startAttempt").onclick=async()=>{
  $("attemptInfo").style.color="";
  try{
    const d=await api("/api/payments/"+currentPayment.id+"/attempt",{
      method:"POST",
      body:JSON.stringify({deviceId,mac})
    });
    renderAttempt(d.attempt);
  }catch(e){
    if(e.data?.attempt){
      renderAttempt(e.data.attempt);
    }else{
      $("attemptInfo").style.color="#ff9ba5";
      $("attemptInfo").textContent=
        e.data?.error==="device_not_seen_by_router"
          ?"A MikroTik ainda não identificou este aparelho. Aguarde alguns segundos e tente novamente."
          :"Não foi possível liberar os 30 segundos: "+(e.data?.error||e.message);
    }
  }
};

function showGroup(g){
  currentGroup=g;
  $("groupCode").textContent=g.code;
  show("groupSuccess");
  $("copyGroupCode").onclick=()=>navigator.clipboard.writeText(g.code);
  $("copyGroupLink").onclick=()=>navigator.clipboard.writeText(g.publicUrl);
}

function startPolling(id){
  clearInterval(pollTimer);
  const poll=async()=>{
    try{
      const d=await api("/api/payments/"+id);
      renderAttempt(d.attempt);
      if(d.payment.status==="approved"){
        clearInterval(pollTimer);
        showOnly("successBox");
        $("successText").textContent=d.access?.ends_at?"Acesso válido até "+new Date(d.access.ends_at).toLocaleString("pt-BR")+".":"Pagamento confirmado.";
        if(d.group)showGroup(d.group);
      }
    }catch{}
  };
  poll();pollTimer=setInterval(poll,2500);
}

boot();
</script>
</body>
</html>`;
}// ============================================================
// ROUTER ACK compatibility
// ============================================================

async function routerAck(request, env) {
  if (!(await requireRouter(request, env))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  return json({ ok: true, acked: 0 });
}

// ============================================================
// ROUTER
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), path = url.pathname;

    if (request.method === "GET" && path === "/") {
      return new Response(
        ["Open Wi-Fi Cloudflare v1.0 Phase 3A.3","","Portal: /portal","Admin: /admin","Health: /health"].join("\n"),
        {headers:{"content-type":"text/plain; charset=utf-8"}}
      );
    }

    if (request.method === "GET" && path === "/health") return health(env);
    if (request.method === "GET" && path === "/portal") return html(portalPage(env));
    if (request.method === "GET" && path === "/group") return html(groupPage());
    if (request.method === "GET" && path === "/admin") return html(adminPage());

    if (request.method === "GET" && path === "/api/site/status") return siteStatus(env);
    if (request.method === "GET" && path === "/api/plans") return listPlans(url, env);
    if (request.method === "GET" && path === "/api/group/public") return publicGroupData(url, env);

    if (request.method === "POST" && path === "/api/device/register") return registerDevice(request, env);
    if (request.method === "POST" && path === "/api/payments/create") return createPayment(request, env);
    if (request.method === "POST" && path === "/api/access-code/redeem") return redeemAccessCode(request, env);
    if (request.method === "POST" && path === "/api/group/join") return joinPartyGroup(request, env);

    const attemptMatch = path.match(/^\/api\/payments\/([0-9a-fA-F-]{36})\/attempt$/);
    if (request.method === "POST" && attemptMatch) return startPaymentAttempt(request, env, attemptMatch[1]);

    const paymentMatch = path.match(/^\/api\/payments\/([0-9a-fA-F-]{36})$/);
    if (request.method === "GET" && paymentMatch) return paymentStatus(url, env, paymentMatch[1]);

    if (request.method === "POST" && path === "/api/mercadopago/webhook") return mercadoPagoWebhook(request, url, env, ctx);
    if (request.method === "POST" && path === "/api/router/poll") return routerPoll(request, env);
    if (request.method === "POST" && path === "/api/router/ack") return routerAck(request, env);

    if (request.method === "POST" && path === "/api/admin/login") return adminLogin(request, env);
    if (request.method === "POST" && path === "/api/admin/logout") return adminLogout();

    if (path.startsWith("/api/admin/")) {
      if (!(await verifyAdminSession(request, env))) return json({ok:false,error:"unauthorized"},401);
      if (request.method === "GET" && path === "/api/admin/dashboard") return adminDashboard(env);
      if (request.method === "GET" && path === "/api/admin/plans") return adminPlans(env);
      if (request.method === "GET" && path === "/api/admin/users") return adminUsers(env);
      if (request.method === "POST" && path === "/api/admin/users/revoke") return adminRevokeUsersAccess(request, env);
      if (request.method === "POST" && path === "/api/admin/plans") return adminPlanSave(request, env);
      const pm = path.match(/^\/api\/admin\/plans\/([^/]+)$/);
      if (pm && request.method === "PUT") return adminPlanSave(request, env, pm[1]);
      if (pm && request.method === "DELETE") return adminPlanDelete(env, pm[1]);
      if (request.method === "PUT" && path === "/api/admin/config") return adminConfigSave(request, env);
      if (request.method === "PUT" && path === "/api/admin/event") return adminEventSave(request, env);
      if (request.method === "GET" && path === "/api/admin/codes") return adminCodes(env);
      if (request.method === "POST" && path === "/api/admin/codes") return adminGenerateCode(request, env);
      if (request.method === "GET" && path === "/api/admin/groups") return adminGroups(url, env);
      if (request.method === "GET" && path === "/api/admin/audit") return adminAudit(env);
    }

    return json({ok:false,error:"not_found"},404);
  },
};
