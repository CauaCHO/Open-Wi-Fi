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
    const found = await env.DB.prepare(
      `SELECT 1 AS ok FROM party_groups WHERE site_id = ? AND code = ?`
    ).bind(siteId, code).first();
    if (!found) return code;
  }
  throw new Error("group_code_generation_failed");
}

async function ensureUniqueAccessCode(env, siteId) {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(8);
    const found = await env.DB.prepare(
      `SELECT 1 AS ok FROM access_codes WHERE site_id = ? AND code = ?`
    ).bind(siteId, code).first();
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
    version: "1.0.0-phase3A",
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
           portal_title, portal_subtitle
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
    },
    event: event ? { ...event, state: eventState } : null,
    plans: plans.results,
  });
}

// ============================================================
// JANELAS TEMPORÁRIAS / ANTI-ABUSO
// ============================================================

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
      SELECT id, payment_id, mac, attempt_number, starts_at, ends_at, status
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
      SELECT id, payment_id, mac, attempt_number, starts_at, ends_at, status
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

  return {
    attemptsUsed,
    attemptsRemaining: Math.max(0, maxAttempts - attemptsUsed),
    maxAttempts,
    activeUntil: active ? Number(active.ends_at) : null,
    activeAttemptNumber: active ? Number(active.attempt_number) : null,
    cooldownUntil,
    inCooldown: !!cooldownUntil && cooldownUntil > now && !active,
  };
}

async function startAttemptWindow(env, payment, mac) {
  const now = Date.now();
  const windowMs = Number(env.ATTEMPT_WINDOW_MS || 30000);
  const maxAttempts = Number(env.MAX_ATTEMPTS || 3);
  const cooldownMs = Number(env.COOLDOWN_MS || 600000);
  const endsAt = now + windowMs;

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
  let b; try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const siteId=String(b.siteId||env.OPENWIFI_SITE_ID||"");
  const deviceId=String(b.deviceId||"");
  const mac=normalizeMac(b.mac);
  const code=String(b.code||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(!deviceId||!validMac(mac)||code.length<6)return json({ok:false,error:"invalid_code_data"},400);

  const mapping=await env.DB.prepare(`SELECT device_id FROM device_macs WHERE site_id=? AND mac=?`).bind(siteId,mac).first();
  if(!mapping||mapping.device_id!==deviceId)return json({ok:false,error:"device_mac_mismatch"},403);
  if(!(await validateCurrentRouterHost(env,siteId,mac)))return json({ok:false,error:"device_not_seen_by_router"},403);

  const now=Date.now();
  const row=await env.DB.prepare(`SELECT * FROM access_codes WHERE site_id=? AND code=? LIMIT 1`).bind(siteId,code).first();
  if(!row)return json({ok:false,error:"access_code_not_found"},404);

  if(row.status==="consumed"&&row.redeemed_device_id===deviceId){
    const grant=await env.DB.prepare(`SELECT starts_at,ends_at,status FROM access_grants WHERE id=?`).bind(`code-${row.id}`).first();
    return json({ok:true,reused:true,access:grant});
  }
  if(row.status!=="active"||Number(row.expires_at)<=now||Number(row.uses)>=Number(row.max_uses)){
    return json({ok:false,error:"access_code_expired"},410);
  }

  let endsAt;
  if(row.mode==="party"){
    const ev=await env.DB.prepare(`SELECT ends_at FROM events WHERE id=? AND site_id=?`).bind(row.event_id,siteId).first();
    if(!ev||Number(ev.ends_at)<=now)return json({ok:false,error:"party_event_ended"},410);
    endsAt=Number(ev.ends_at);
  }else{
    endsAt=now+Number(row.duration_seconds||86400)*1000;
  }

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE access_codes SET uses=uses+1,
        status=CASE WHEN uses+1>=max_uses THEN 'consumed' ELSE status END,
        redeemed_device_id=?,redeemed_at=?,updated_at=?
       WHERE id=? AND status='active' AND uses<max_uses
    `).bind(deviceId,now,now,row.id),
    env.DB.prepare(`
      INSERT INTO access_grants(id,site_id,device_id,payment_id,starts_at,ends_at,status,created_at,updated_at)
      VALUES(?,?,?,NULL,?,?,'active',?,?)
      ON CONFLICT(id) DO NOTHING
    `).bind(`code-${row.id}`,siteId,deviceId,now,endsAt,now,now)
  ]);
  return json({ok:true,access:{starts_at:now,ends_at:endsAt,status:"active"}});
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
return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grupo • Open Wi-Fi</title>
<style>*{box-sizing:border-box}body{margin:0;background:#07110f;color:#f4fffb;font-family:system-ui}.w{max-width:520px;margin:auto;padding:26px 16px}.c{background:#0d1b18;border:1px solid #1e3b34;border-radius:20px;padding:18px;margin-bottom:12px}.big{font-size:34px;font-weight:900;color:#4ee0b6}.muted{color:#9fb8af}.slot{border-top:1px solid #1e3b34;padding:11px 0}</style></head><body><div class="w"><div class="c"><h2 id="ev">Open Wi-Fi</h2><div class="muted">Acompanhamento do representante • somente leitura</div><div class="big" id="count">—</div><div id="exp" class="muted"></div></div><div class="c"><div class="muted">Código</div><div class="big" id="code">—</div></div><div class="c" id="members"><b>Dispositivos</b></div></div><script>
const token=new URLSearchParams(location.search).get("token")||"";async function load(){const r=await fetch("/api/group/public?token="+encodeURIComponent(token));const d=await r.json();if(!d.ok)return;const g=d.group;document.getElementById("ev").textContent=g.eventName;document.getElementById("count").textContent=g.usedDevices+" / "+g.maxDevices;document.getElementById("code").textContent=g.code;document.getElementById("exp").textContent="Válido até "+new Date(g.expiresAt).toLocaleString("pt-BR");document.getElementById("members").innerHTML="<b>Dispositivos</b>"+g.members.map(m=>"<div class='slot'>"+m.label+(m.owner?" • representante":"")+"</div>").join("")}load();setInterval(load,10000)</script></body></html>`;
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
    activeGrants:Number(active?.c||0),pendingPayments:Number(pending?.c||0),activeAttempts:Number(attempts?.c||0)
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
  let b;try{b=await request.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main",mode=b.mode==="party"?"party":"standard",bg=b.backgroundMode==="image"?"image":"gradient";
  const bgUrl=bg==="image"&&/^https:\/\//.test(String(b.backgroundImageUrl||""))?String(b.backgroundImageUrl):null;
  await env.DB.prepare(`UPDATE sites SET mode=?,background_mode=?,background_image_url=?,support_whatsapp=?,require_whatsapp_standard=?,sales_enabled=?,portal_title=?,portal_subtitle=?,updated_at=? WHERE id=?`).bind(
    mode,bg,bgUrl,normalizePhone(b.supportWhatsapp)||null,b.requireWhatsappStandard?1:0,b.salesEnabled===false?0:1,
    String(b.portalTitle||"Open Wi-Fi").slice(0,80),String(b.portalSubtitle||"Escolha seu acesso, pague via Pix e conecte.").slice(0,180),Date.now(),siteId
  ).run();
  await audit(env,siteId,"site.config",{mode,bg,salesEnabled:b.salesEnabled!==false});return json({ok:true});
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

async function adminGenerateCode(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main",site=await env.DB.prepare(`SELECT mode,active_event_id FROM sites WHERE id=?`).bind(siteId).first(),now=Date.now();
  let eventId=null,expiresAt,duration=null;
  if(site?.mode==="party"){
    if(!site.active_event_id)return json({ok:false,error:"party_event_required"},409);
    const ev=await env.DB.prepare(`SELECT id,ends_at FROM events WHERE id=?`).bind(site.active_event_id).first();
    if(!ev||Number(ev.ends_at)<=now)return json({ok:false,error:"party_event_ended"},409);
    eventId=ev.id;expiresAt=Number(ev.ends_at);
  }else{expiresAt=now+86400000;duration=86400}
  const code=await ensureUniqueAccessCode(env,siteId),id=uuid();
  await env.DB.prepare(`INSERT INTO access_codes(id,site_id,code,mode,event_id,duration_seconds,expires_at,max_uses,uses,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,0,'active',?,?)`).bind(id,siteId,code,site.mode,eventId,duration,expiresAt,now,now).run();
  await audit(env,siteId,"access_code.create",{code,mode:site.mode,expiresAt});return json({ok:true,code,mode:site.mode,expiresAt});
}

async function adminCodes(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main",now=Date.now();
  await env.DB.prepare(`UPDATE access_codes SET status='expired',updated_at=? WHERE site_id=? AND status='active' AND expires_at<=?`).bind(now,siteId,now).run();
  const r=await env.DB.prepare(`SELECT code,mode,status,uses,max_uses,expires_at,redeemed_at,created_at FROM access_codes WHERE site_id=? ORDER BY created_at DESC LIMIT 50`).bind(siteId).all();
  return json({ok:true,codes:r.results});
}

async function adminGroups(url,env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main",phone=normalizePhone(url.searchParams.get("phone")||"");
  let sql=`SELECT pg.id,pg.code,pg.phone_e164,pg.max_devices,pg.expires_at,pg.public_token,e.name AS event_name,COUNT(gm.device_id) AS used_devices FROM party_groups pg LEFT JOIN events e ON e.id=pg.event_id LEFT JOIN group_members gm ON gm.group_id=pg.id WHERE pg.site_id=?`;
  const binds=[siteId];if(phone){sql+=` AND pg.phone_e164 LIKE ?`;binds.push(`%${phone}%`)}sql+=` GROUP BY pg.id ORDER BY pg.created_at DESC LIMIT 50`;
  const r=await env.DB.prepare(sql).bind(...binds).all();
  return json({ok:true,groups:r.results.map(g=>({...g,public_url:`${env.OPENWIFI_BASE_URL||""}/group?token=${g.public_token}`}))});
}

async function adminAudit(env){
  const siteId=env.OPENWIFI_SITE_ID||"openwifi-main";
  const r=await env.DB.prepare(`SELECT action,details_json,created_at FROM admin_audit WHERE site_id=? ORDER BY created_at DESC LIMIT 50`).bind(siteId).all();
  return json({ok:true,audit:r.results});
}

function adminPage(){
return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Wi-Fi • Admin</title>
<style>:root{color-scheme:dark;--card:#0d1b18;--line:#1e3b34;--txt:#f4fffb;--muted:#9fb8af;--a:#4ee0b6}*{box-sizing:border-box}body{margin:0;background:#07110f;color:var(--txt);font-family:system-ui}.w{max-width:1180px;margin:auto;padding:20px}.top{display:flex;justify-content:space-between;align-items:center;gap:10px}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:16px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:15px}.metric b{font-size:24px;color:var(--a)}.muted{color:var(--muted);font-size:13px}.tabs{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0}.btn{border:1px solid var(--line);background:#143028;color:var(--txt);border-radius:11px;padding:9px 12px;cursor:pointer;font-weight:700}.primary{background:var(--a);color:#05251d}.danger{background:#3a171c}.hidden{display:none!important}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.row3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}label{display:block;color:var(--muted);font-size:12px;margin:9px 0 4px}input,select{width:100%;background:#071411;border:1px solid var(--line);color:var(--txt);border-radius:10px;padding:9px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}.scroll{overflow:auto}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.row,.row3{grid-template-columns:1fr}}</style></head><body><div class="w">
<div class="top"><div><h1>Open Wi-Fi • Admin</h1><div class="muted">Cloudflare + D1 + MikroTik</div></div><button class="btn" id="logout">Sair</button></div>
<section id="loginBox" class="card" style="max-width:410px;margin:50px auto"><h2>Entrar</h2><label>Usuário</label><input id="user" value="admin"><label>Senha</label><input id="pass" type="password"><button class="btn primary" style="width:100%;margin-top:11px" id="login">Entrar</button><div class="muted" id="loginErr"></div></section>
<main id="app" class="hidden"><div class="grid" id="metrics"></div><div class="tabs"><button class="btn" data-tab="dash">Acompanhamento</button><button class="btn" data-tab="mode">Modo / Evento</button><button class="btn" data-tab="plans">Produtos / Preços</button><button class="btn" data-tab="portal">Portal / Background</button><button class="btn" data-tab="codes">Códigos</button><button class="btn" data-tab="groups">Duplas / Grupos</button><button class="btn" data-tab="audit">Auditoria</button></div>
<section id="dash" class="tab card"><h2>Pagamentos recentes</h2><div class="scroll"><table><thead><tr><th>Plano</th><th>Status</th><th>Valor</th><th>E-mail</th><th>WhatsApp</th><th>Hora</th></tr></thead><tbody id="payments"></tbody></table></div></section>
<section id="mode" class="tab card hidden"><h2>Modo e evento</h2><div class="row"><div><label>Modo</label><select id="modeSel"><option value="standard">Padrão</option><option value="party">Party</option></select></div><div><label>Vendas</label><select id="sales"><option value="1">Ativas</option><option value="0">Pausadas</option></select></div></div><h3>Evento</h3><label>Nome</label><input id="eventName"><div class="row"><div><label>Início</label><input id="eventStart" type="datetime-local"></div><div><label>Fim</label><input id="eventEnd" type="datetime-local"></div></div><button class="btn primary" id="saveMode" style="margin-top:10px">Salvar modo</button> <button class="btn" id="saveEvent">Salvar evento</button></section>
<section id="plans" class="tab card hidden"><div class="top"><h2>Produtos / preços</h2><button class="btn primary" id="newPlan">Novo</button></div><div class="scroll"><table><thead><tr><th>Nome</th><th>Modo</th><th>Preço</th><th>Duração</th><th>Disp.</th><th>Ativo</th><th></th></tr></thead><tbody id="plansRows"></tbody></table></div><div id="planForm" class="hidden"><hr><input id="planId" type="hidden"><div class="row3"><div><label>Nome</label><input id="planName"></div><div><label>Slug</label><input id="planSlug"></div><div><label>Modo</label><select id="planMode"><option>standard</option><option>party</option><option>both</option></select></div></div><div class="row3"><div><label>Preço R$</label><input id="planPrice" type="number" step=".01"></div><div><label>Duração min</label><input id="planMinutes" type="number"></div><div><label>Máx. dispositivos</label><input id="planMax" type="number"></div></div><label><input id="planEventEnd" type="checkbox" style="width:auto"> até o fim do evento</label><label><input id="planEnabled" type="checkbox" style="width:auto" checked> ativo</label><button class="btn primary" id="savePlan">Salvar</button></div></section>
<section id="portal" class="tab card hidden"><h2>Portal</h2><div class="row"><div><label>Título</label><input id="portalTitle"></div><div><label>WhatsApp suporte</label><input id="supportWhatsapp"></div></div><label>Subtítulo</label><input id="portalSubtitle"><label><input id="requireWhatsappStandard" type="checkbox" style="width:auto"> exigir WhatsApp no Padrão</label><div class="row"><div><label>Background</label><select id="bgMode"><option value="gradient">Sem imagem</option><option value="image">Com imagem</option></select></div><div><label>URL HTTPS</label><input id="bgUrl"></div></div><button class="btn primary" id="savePortal" style="margin-top:10px">Salvar portal</button></section>
<section id="codes" class="tab card hidden"><div class="top"><div><h2>Códigos de acesso</h2><div class="muted">Party: evento • Padrão: 24h</div></div><button class="btn primary" id="genCode">Gerar código único</button></div><div id="newCode" style="font-size:28px;font-weight:900;color:var(--a);margin:10px 0"></div><table><thead><tr><th>Código</th><th>Modo</th><th>Status</th><th>Expira</th></tr></thead><tbody id="codesRows"></tbody></table></section>
<section id="groups" class="tab card hidden"><div class="top"><h2>Duplas / grupos</h2><input id="groupPhone" style="max-width:260px" placeholder="Buscar WhatsApp"></div><div class="scroll"><table><thead><tr><th>Código</th><th>WhatsApp</th><th>Ocupação</th><th>Expira</th><th>Representante</th></tr></thead><tbody id="groupsRows"></tbody></table></div></section>
<section id="audit" class="tab card hidden"><h2>Auditoria</h2><div id="auditRows" class="muted"></div></section></main></div>
<script>
const $=id=>document.getElementById(id);let state=null,plans=[];async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{"content-type":"application/json",...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Erro");return d}function brl(c){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format((c||0)/100)}function dt(v){return v?new Date(v).toLocaleString("pt-BR"):"—"}function localInput(v){if(!v)return"";const d=new Date(Number(v)),z=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate())+"T"+z(d.getHours())+":"+z(d.getMinutes())}function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m]))}
async function boot(){try{state=await api("/api/admin/dashboard");$("loginBox").classList.add("hidden");$("app").classList.remove("hidden");renderDash();await Promise.all([loadPlans(),loadCodes(),loadGroups(),loadAudit()])}catch{$("loginBox").classList.remove("hidden");$("app").classList.add("hidden")}}
$("login").onclick=async()=>{try{await api("/api/admin/login",{method:"POST",body:JSON.stringify({user:$("user").value,password:$("pass").value})});boot()}catch{$("loginErr").textContent="Login inválido"}};$("logout").onclick=async()=>{await api("/api/admin/logout",{method:"POST"});location.reload()};document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.add("hidden"));$(b.dataset.tab).classList.remove("hidden")});
function renderDash(){const m=state.metrics;$("metrics").innerHTML=[["RB",m.routerOnline?"ONLINE":"OFFLINE"],["Clientes",m.routerHostCount],["Vendas hoje",m.paidToday],["Receita",brl(m.revenueTodayCents)],["Acessos",m.activeGrants],["Pix pendentes",m.pendingPayments]].map(x=>"<div class='card metric'><div class='muted'>"+x[0]+"</div><b>"+x[1]+"</b></div>").join("");$("payments").innerHTML=state.recentPayments.map(p=>"<tr><td>"+esc(p.plan_name)+"</td><td>"+p.status+"</td><td>"+brl(p.amount_cents)+"</td><td>"+esc(p.payer_email||"—")+"</td><td>"+esc(p.phone_e164||"—")+"</td><td>"+dt(p.created_at)+"</td></tr>").join("");$("modeSel").value=state.site.mode;$("sales").value=state.site.sales_enabled?"1":"0";$("portalTitle").value=state.site.portal_title||"";$("portalSubtitle").value=state.site.portal_subtitle||"";$("supportWhatsapp").value=state.site.support_whatsapp||"";$("requireWhatsappStandard").checked=!!state.site.require_whatsapp_standard;$("bgMode").value=state.site.background_mode||"gradient";$("bgUrl").value=state.site.background_image_url||"";if(state.event){$("eventName").value=state.event.name||"";$("eventStart").value=localInput(state.event.starts_at);$("eventEnd").value=localInput(state.event.ends_at)}}
async function saveConfig(){await api("/api/admin/config",{method:"PUT",body:JSON.stringify({mode:$("modeSel").value,salesEnabled:$("sales").value==="1",backgroundMode:$("bgMode").value,backgroundImageUrl:$("bgUrl").value,supportWhatsapp:$("supportWhatsapp").value,requireWhatsappStandard:$("requireWhatsappStandard").checked,portalTitle:$("portalTitle").value,portalSubtitle:$("portalSubtitle").value})});await boot()}$("saveMode").onclick=saveConfig;$("savePortal").onclick=saveConfig;$("saveEvent").onclick=async()=>{await api("/api/admin/event",{method:"PUT",body:JSON.stringify({name:$("eventName").value,startsAt:new Date($("eventStart").value).getTime(),endsAt:new Date($("eventEnd").value).getTime()})});await boot()};
async function loadPlans(){const d=await api("/api/admin/plans");plans=d.plans;$("plansRows").innerHTML=plans.map(p=>"<tr><td>"+esc(p.name)+"</td><td>"+p.mode+"</td><td>"+brl(p.price_cents)+"</td><td>"+(p.party_until_event_end?"Evento":Math.round((p.duration_seconds||0)/60)+" min")+"</td><td>"+p.max_devices+"</td><td>"+(p.enabled?"sim":"não")+"</td><td><button class='btn' onclick='editPlan("+JSON.stringify(p.id)+")'>Editar</button> <button class='btn danger' onclick='delPlan("+JSON.stringify(p.id)+")'>Excluir</button></td></tr>").join("")}window.editPlan=id=>{const p=plans.find(x=>x.id===id);$("planForm").classList.remove("hidden");$("planId").value=p.id;$("planName").value=p.name;$("planSlug").value=p.slug;$("planMode").value=p.mode;$("planPrice").value=(p.price_cents/100).toFixed(2);$("planMinutes").value=p.duration_seconds?Math.round(p.duration_seconds/60):60;$("planMax").value=p.max_devices;$("planEventEnd").checked=!!p.party_until_event_end;$("planEnabled").checked=!!p.enabled};$("newPlan").onclick=()=>{$("planForm").classList.remove("hidden");$("planId").value="";$("planName").value="";$("planSlug").value="";$("planPrice").value="2";$("planMinutes").value="60";$("planMax").value="1";$("planMode").value="standard";$("planEventEnd").checked=false;$("planEnabled").checked=true};$("savePlan").onclick=async()=>{const id=$("planId").value,b={name:$("planName").value,slug:$("planSlug").value,mode:$("planMode").value,priceCents:Math.round(Number($("planPrice").value)*100),durationSeconds:Number($("planMinutes").value)*60,maxDevices:Number($("planMax").value),partyUntilEventEnd:$("planEventEnd").checked,enabled:$("planEnabled").checked};await api("/api/admin/plans"+(id?"/"+id:""),{method:id?"PUT":"POST",body:JSON.stringify(b)});$("planForm").classList.add("hidden");loadPlans()};window.delPlan=async id=>{if(confirm("Excluir/desativar?")){await api("/api/admin/plans/"+id,{method:"DELETE"});loadPlans()}};
async function loadCodes(){const d=await api("/api/admin/codes");$("codesRows").innerHTML=d.codes.map(c=>"<tr><td><b>"+c.code+"</b></td><td>"+c.mode+"</td><td>"+c.status+"</td><td>"+dt(c.expires_at)+"</td></tr>").join("")}$("genCode").onclick=async()=>{const d=await api("/api/admin/codes",{method:"POST"});$("newCode").textContent=d.code+" • "+(d.mode==="party"?"evento":"24h");loadCodes()};
async function loadGroups(){const q=$("groupPhone").value?"?phone="+encodeURIComponent($("groupPhone").value):"";const d=await api("/api/admin/groups"+q);$("groupsRows").innerHTML=d.groups.map(g=>"<tr><td><b>"+g.code+"</b></td><td>"+esc(g.phone_e164||"—")+"</td><td>"+g.used_devices+" / "+g.max_devices+"</td><td>"+dt(g.expires_at)+"</td><td><button class='btn' onclick='navigator.clipboard.writeText("+JSON.stringify(g.public_url)+")'>Copiar link</button></td></tr>").join("")}$("groupPhone").oninput=()=>{clearTimeout(window.gt);window.gt=setTimeout(loadGroups,300)};
async function loadAudit(){const d=await api("/api/admin/audit");$("auditRows").innerHTML=d.audit.map(a=>"<div style='padding:8px 0;border-bottom:1px solid #1e3b34'><b>"+esc(a.action)+"</b> • "+dt(a.created_at)+"<br>"+esc(a.details_json||"")+"</div>").join("")}boot();setInterval(async()=>{if(!$("app").classList.contains("hidden")){try{state=await api("/api/admin/dashboard");renderDash()}catch{}}},10000);
</script></body></html>`;
}

// ============================================================
// PORTAL HTML
// ============================================================

function portalPage(env) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Wi-Fi</title>
<style>:root{color-scheme:dark;--card:#0d1b18;--line:#1e3b34;--txt:#f4fffb;--muted:#9fb8af;--a:#4ee0b6;--ok:#65e7a6;--err:#ff6f7d}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#163e34 0,transparent 42%),linear-gradient(180deg,#06100d,#091713);background-size:cover;background-position:center;min-height:100vh;color:var(--txt);font-family:system-ui}.w{max-width:520px;margin:auto;padding:24px 16px 42px}.brand{text-align:center;padding:10px 0 20px}.mark{width:66px;height:66px;border-radius:19px;margin:auto auto 11px;display:grid;place-items:center;background:linear-gradient(145deg,var(--a),#a1ffe4);color:#05251d;font-size:31px;font-weight:900}.muted{color:var(--muted);font-size:13px}.c{background:rgba(13,27,24,.95);border:1px solid var(--line);border-radius:20px;padding:17px;margin-bottom:12px}.title{font-weight:850;font-size:17px}.plans{display:grid;gap:9px;margin-top:12px}.plan{border:1px solid var(--line);background:#10231f;color:var(--txt);border-radius:15px;padding:13px;display:flex;justify-content:space-between;text-align:left}.price{color:var(--a);font-weight:900}label{display:block;color:var(--muted);font-size:12px;margin:9px 0 4px}input{width:100%;background:#071411;border:1px solid var(--line);border-radius:12px;padding:11px;color:var(--txt)}.btn{width:100%;border:1px solid var(--line);background:#17332c;color:var(--txt);border-radius:12px;padding:11px;margin-top:8px;font-weight:850}.primary{background:var(--a);color:#05251d}.hidden{display:none!important}.center{text-align:center}.qr{width:min(270px,80vw);background:#fff;padding:8px;border-radius:14px;margin:12px auto}.codebig{font-size:27px;color:var(--a);font-weight:900}.ok{color:var(--ok)}.err{color:var(--err)}</style></head><body><div class="w">
<div class="brand"><div class="mark">⌁</div><h1 id="brandTitle">Open Wi-Fi</h1><div class="muted" id="brandSub"></div></div>
<section class="c" id="loading"><div class="title">Identificando aparelho...</div><div class="muted" id="loadingText">Aguarde.</div></section>
<section class="c hidden" id="plansBox"><div class="title" id="modeTitle">Escolha seu plano</div><div class="muted" id="eventText"></div><div class="plans" id="plans"></div><button class="btn" id="showAccessCode">Tenho um código de acesso</button><button class="btn hidden" id="showGroupCode">Entrar em Dupla / Grupo</button></section>
<section class="c hidden" id="codeBox"><div class="title" id="codeTitle"></div><label>Código</label><input id="codeInput"><button class="btn primary" id="redeemCode">Usar código</button><button class="btn" id="backCode">Voltar</button><div class="muted err" id="codeErr"></div></section>
<section class="c hidden" id="checkoutBox"><div class="title" id="checkoutTitle"></div><div class="muted" id="checkoutSub"></div><label>E-mail</label><input id="email" type="email"><label>WhatsApp</label><input id="phone" inputmode="tel"><div class="muted" id="phoneHint"></div><button class="btn primary" id="createPix">Gerar Pix</button><button class="btn" id="backPlans">Voltar</button><div class="muted err" id="checkoutError"></div></section>
<section class="c hidden center" id="pixBox"><div class="title">Pague com Pix</div><div class="muted" id="pixPlan"></div><img class="qr" id="qr"><label style="text-align:left">Pix Copia e Cola</label><input id="pixCode" readonly><button class="btn primary" id="copyPix">Copiar Pix</button><div id="payStatus" style="margin-top:10px;font-weight:850">Aguardando pagamento...</div><button class="btn" id="startAttempt">Liberar internet por 30 s</button><div class="muted" id="attemptInfo"></div></section>
<section class="c hidden center" id="successBox"><div style="font-size:42px">✓</div><div class="title ok">Acesso liberado</div><div class="muted" id="successText"></div><div id="groupSuccess" class="hidden"><div class="muted" style="margin-top:13px">Código do grupo</div><div class="codebig" id="groupCode"></div><button class="btn" id="copyGroupCode">Copiar código</button><button class="btn" id="openGroupView">Abrir acompanhamento</button></div></section><div class="muted center" id="support"></div></div>
<script>
const q=new URLSearchParams(location.search),siteId=q.get("site")||"openwifi-main",mac=(q.get("mac")||"").toUpperCase(),ip=q.get("ip")||"",KEY="openwifi_device_id_v1";let deviceId=localStorage.getItem(KEY)||crypto.randomUUID();localStorage.setItem(KEY,deviceId);let selectedPlan,currentPayment,pollTimer,siteData,codeMode="access";const $=id=>document.getElementById(id),show=id=>$(id).classList.remove("hidden"),hide=id=>$(id).classList.add("hidden"),brl=c=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(c/100),esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m]));async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{"content-type":"application/json",...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||"Erro");e.data=d;throw e}return d}function dur(p){if(p.party_until_event_end)return"Até o fim do evento";const s=p.duration_seconds||0;if(s===3600)return"1 hora";if(s===86400)return"1 dia";if(s===604800)return"1 semana";if(s===2592000)return"30 dias";return Math.round(s/3600)+" h"}
async function boot(){if(!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)){$("loadingText").textContent="Abra pela rede Open Wi-Fi.";return}try{const reg=await api("/api/device/register",{method:"POST",body:JSON.stringify({siteId,mac,ip,deviceId})});deviceId=reg.deviceId;localStorage.setItem(KEY,deviceId);if(reg.activeUntil>Date.now()){hide("loading");show("successBox");$("successText").textContent="Este aparelho já possui acesso ativo.";return}const d=await api("/api/plans?site="+siteId);siteData=d;$("brandTitle").textContent=d.site.portalTitle;$("brandSub").textContent=d.site.portalSubtitle;$("modeTitle").textContent=d.site.mode==="party"?"Planos do evento":"Escolha seu plano";$("eventText").textContent=d.event?d.event.name+" • até "+new Date(d.event.ends_at).toLocaleString("pt-BR"):"";$("showGroupCode").classList.toggle("hidden",d.site.mode!=="party");$("support").textContent=d.site.supportWhatsapp?"Suporte WhatsApp: +"+d.site.supportWhatsapp:"";if(d.site.backgroundMode==="image"&&d.site.backgroundImageUrl)document.body.style.backgroundImage="linear-gradient(rgba(4,14,11,.55),rgba(4,14,11,.55)),url('"+d.site.backgroundImageUrl.replace(/'/g,"")+"')";renderPlans(d.plans);hide("loading");show("plansBox")}catch(e){$("loadingText").textContent=e.message}}
function renderPlans(ps){$("plans").innerHTML=ps.map(p=>"<button class='plan' data-id='"+p.id+"'><span><b>"+esc(p.name)+"</b><br><small>"+dur(p)+(p.max_devices>1?" • "+p.max_devices+" dispositivos":"")+"</small></span><span class='price'>"+brl(p.price_cents)+"</span></button>").join("");document.querySelectorAll(".plan").forEach(b=>b.onclick=()=>choosePlan(ps.find(p=>p.id===b.dataset.id)))}function choosePlan(p){selectedPlan=p;$("checkoutTitle").textContent=p.name+" • "+brl(p.price_cents);$("checkoutSub").textContent=dur(p);$("phoneHint").textContent=(siteData.site.mode==="party"||siteData.site.requireWhatsappStandard)?"WhatsApp obrigatório.":"WhatsApp opcional.";hide("plansBox");show("checkoutBox")}$("backPlans").onclick=()=>{hide("checkoutBox");show("plansBox")};function openCode(m){codeMode=m;$("codeTitle").textContent=m==="group"?"Código da Dupla / Grupo":"Código de acesso";hide("plansBox");show("codeBox")}$("showAccessCode").onclick=()=>openCode("access");$("showGroupCode").onclick=()=>openCode("group");$("backCode").onclick=()=>{hide("codeBox");show("plansBox")};$("redeemCode").onclick=async()=>{try{const path=codeMode==="group"?"/api/group/join":"/api/access-code/redeem",d=await api(path,{method:"POST",body:JSON.stringify({siteId,deviceId,mac,code:$("codeInput").value})});hide("codeBox");show("successBox");$("successText").textContent=codeMode==="group"?"Você entrou no grupo.":"Código aceito.";if(d.group)showGroup(d.group)}catch(e){$("codeErr").textContent=e.message}};
$("createPix").onclick=async()=>{try{const d=await api("/api/payments/create",{method:"POST",body:JSON.stringify({siteId,deviceId,planId:selectedPlan.id,mac,ip,email:$("email").value,phone:$("phone").value})});currentPayment=d.payment;hide("checkoutBox");show("pixBox");$("pixPlan").textContent=d.payment.planName+" • "+brl(d.payment.amountCents);$("pixCode").value=d.payment.qrCode||"";if(d.payment.qrCodeBase64)$("qr").src="data:image/png;base64,"+d.payment.qrCodeBase64;renderAttempt(null);startPolling(d.payment.id)}catch(e){$("checkoutError").textContent=e.message}};$("copyPix").onclick=async()=>{try{await navigator.clipboard.writeText($("pixCode").value)}catch{}};
function renderAttempt(a){const now=Date.now();if(!a){$("startAttempt").disabled=false;$("attemptInfo").textContent="";return}if(a.activeUntil>now){$("startAttempt").disabled=true;$("attemptInfo").textContent="Tentativa "+a.activeAttemptNumber+"/"+a.maxAttempts+" • "+Math.ceil((a.activeUntil-now)/1000)+" s";return}if(a.cooldownUntil>now){$("startAttempt").disabled=true;$("attemptInfo").textContent="Novas tentativas em "+Math.ceil((a.cooldownUntil-now)/1000)+" s";return}$("startAttempt").disabled=false;$("attemptInfo").textContent=a.attemptsUsed+"/"+a.maxAttempts+" tentativas usadas"}$("startAttempt").onclick=async()=>{try{const d=await api("/api/payments/"+currentPayment.id+"/attempt",{method:"POST",body:JSON.stringify({deviceId,mac})});renderAttempt(d.attempt)}catch(e){if(e.data?.attempt)renderAttempt(e.data.attempt)}};function showGroup(g){$("groupCode").textContent=g.code;show("groupSuccess");$("copyGroupCode").onclick=()=>navigator.clipboard.writeText(g.code);$("openGroupView").onclick=()=>window.open(g.publicUrl,"_blank","noopener")}function startPolling(id){clearInterval(pollTimer);const poll=async()=>{try{const d=await api("/api/payments/"+id);renderAttempt(d.attempt);if(d.payment.status==="approved"){clearInterval(pollTimer);hide("pixBox");show("successBox");$("successText").textContent=d.access?.ends_at?"Válido até "+new Date(d.access.ends_at).toLocaleString("pt-BR"):"Pagamento confirmado.";if(d.group)showGroup(d.group)}}catch{}};poll();pollTimer=setInterval(poll,2500)}boot();
</script></body></html>`;
}
// ============================================================
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
        ["Open Wi-Fi Cloudflare v1.0 Phase 3A","","Portal: /portal","Admin: /admin","Health: /health"].join("\n"),
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
      if (request.method === "POST" && path === "/api/admin/plans") return adminPlanSave(request, env);
      const pm = path.match(/^\/api\/admin\/plans\/([^/]+)$/);
      if (pm && request.method === "PUT") return adminPlanSave(request, env, pm[1]);
      if (pm && request.method === "DELETE") return adminPlanDelete(env, pm[1]);
      if (request.method === "PUT" && path === "/api/admin/config") return adminConfigSave(request, env);
      if (request.method === "PUT" && path === "/api/admin/event") return adminEventSave(request, env);
      if (request.method === "GET" && path === "/api/admin/codes") return adminCodes(env);
      if (request.method === "POST" && path === "/api/admin/codes") return adminGenerateCode(env);
      if (request.method === "GET" && path === "/api/admin/groups") return adminGroups(url, env);
      if (request.method === "GET" && path === "/api/admin/audit") return adminAudit(env);
    }

    return json({ok:false,error:"not_found"},404);
  },
};
