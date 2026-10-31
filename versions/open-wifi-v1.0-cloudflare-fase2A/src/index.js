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
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
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
    version: "1.0.0-phase2A",
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

  const active = await env.DB.prepare(`
    SELECT DISTINCT dm.mac, ag.ends_at
      FROM access_grants ag
      JOIN device_macs dm
        ON dm.device_id = ag.device_id
       AND dm.site_id = ag.site_id
     WHERE ag.site_id = ?
       AND ag.status = 'active'
       AND ag.starts_at <= ?
       AND ag.ends_at > ?
     ORDER BY ag.ends_at ASC
  `).bind(siteId, now, now).all();

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
    SELECT id, name, mode FROM sites WHERE id = ?
  `).bind(siteId).first();

  if (!site) return json({ ok: false, error: "site_not_found" }, 404);

  if (site.mode !== "standard") {
    return json({
      ok: false,
      error: "party_mode_not_available_in_phase2a",
      mode: site.mode,
    }, 409);
  }

  const plans = await env.DB.prepare(`
    SELECT id, slug, name, price_cents, duration_seconds, max_devices, sort_order
      FROM plans
     WHERE site_id = ?
       AND enabled = 1
       AND mode IN ('standard','both')
     ORDER BY sort_order, price_cents
  `).bind(siteId).all();

  return json({
    ok: true,
    site: { id: site.id, name: site.name, mode: site.mode },
    plans: plans.results,
  });
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
    order?.id || null,
    tx?.id || null,
    order?.status || null,
    order?.status_detail || null,
    localStatus,
    paymentMethod?.qr_code || null,
    paymentMethod?.qr_code_base64 || null,
    now,
    now,
    localStatus,
    now,
    paymentRow.id
  ).run();

  if (localStatus === "approved") {
    const plan = await env.DB.prepare(`
      SELECT duration_seconds
        FROM plans
       WHERE id = ? AND site_id = ?
    `).bind(paymentRow.plan_id, paymentRow.site_id).first();

    if (!plan || !Number(plan.duration_seconds)) {
      throw new Error("plan_duration_missing");
    }

    const grantId = `grant-${paymentRow.id}`;
    const startsAt = now;
    const endsAt = startsAt + Number(plan.duration_seconds) * 1000;

    await env.DB.prepare(`
      INSERT INTO access_grants
        (id, site_id, device_id, payment_id, starts_at, ends_at,
         status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).bind(
      grantId,
      paymentRow.site_id,
      paymentRow.device_id,
      paymentRow.id,
      startsAt,
      endsAt,
      now,
      now
    ).run();
  }

  if (["refunded", "cancelled", "failed"].includes(localStatus)) {
    await env.DB.prepare(`
      UPDATE access_grants
         SET status = 'revoked',
             updated_at = ?
       WHERE payment_id = ?
         AND status = 'active'
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

  if (!siteId || !deviceId || !planId || !validMac(mac) ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: "invalid_payment_data" }, 400);
  }

  const mapping = await env.DB.prepare(`
    SELECT device_id
      FROM device_macs
     WHERE site_id = ?
       AND mac = ?
  `).bind(siteId, mac).first();

  if (!mapping || mapping.device_id !== deviceId) {
    return json({ ok: false, error: "device_mac_mismatch" }, 403);
  }

  const host = await validateCurrentRouterHost(env, siteId, mac);
  if (!host) {
    return json({ ok: false, error: "device_not_seen_by_router" }, 403);
  }

  const plan = await env.DB.prepare(`
    SELECT id, name, price_cents, duration_seconds
      FROM plans
     WHERE id = ?
       AND site_id = ?
       AND enabled = 1
       AND mode IN ('standard','both')
  `).bind(planId, siteId).first();

  if (!plan) return json({ ok: false, error: "plan_not_found" }, 404);

  const now = Date.now();

  // Reutiliza o mesmo Pix para mesmo aparelho + plano enquanto ele estiver válido.
  let payment = await env.DB.prepare(`
    SELECT *
      FROM payments
     WHERE site_id = ?
       AND device_id = ?
       AND plan_id = ?
       AND status = 'pending'
       AND mp_expires_at > ?
     ORDER BY created_at DESC
     LIMIT 1
  `).bind(siteId, deviceId, planId, now).first();

  if (!payment) {
    const id = uuid();
    const externalReference = `ow_${id.replace(/-/g, "")}`;
    const idempotencyKey = uuid();
    const mpExpiresAt = now + 30 * 60 * 1000;
    const attemptWindowUntil = now + Number(env.ATTEMPT_WINDOW_MS || 30000);

    await env.DB.prepare(`
      INSERT INTO payments (
        id, site_id, device_id, plan_id, event_id, mp_order_id,
        payer_email, phone_e164, amount_cents, fee_cents, status,
        created_at, approved_at, updated_at,
        external_reference, idempotency_key, mp_expires_at,
        attempt_window_until
      )
      VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?, NULL, 'pending',
              ?, NULL, ?, ?, ?, ?, ?)
    `).bind(
      id, siteId, deviceId, planId, email, plan.price_cents,
      now, now, externalReference, idempotencyKey, mpExpiresAt,
      attemptWindowUntil
    ).run();

    payment = await env.DB.prepare(`SELECT * FROM payments WHERE id = ?`)
      .bind(id).first();
  }

  try {
    if (!payment.mp_order_id || !payment.qr_code) {
      await createMpOrder(env, payment, plan, email);
    }
  } catch (err) {
    if (err?.status === 429) {
      return json({
        ok: false,
        error: "mercadopago_rate_limited",
        retryAfter: err.retryAfter || null,
      }, 503);
    }

    // Ambiguidade de rede: não marcamos como failed para poder repetir
    // a MESMA criação com a mesma idempotency key.
    return json({
      ok: false,
      error: "mercadopago_create_failed",
      details: err?.data || String(err?.message || err),
    }, 502);
  }

  const saved = await getPaymentForResponse(env, payment.id);

  return json({
    ok: true,
    reused: !!payment.mp_order_id,
    payment: publicPayment(saved),
  });
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

  return json({
    ok: true,
    payment: publicPayment(payment),
    access: grant || null,
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
// PORTAL HTML
// ============================================================

function portalPage(env) {
  const base = env.OPENWIFI_BASE_URL || "";
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Open Wi-Fi</title>
<style>
:root{
  color-scheme:dark;
  --bg:#07110f;--card:#0d1b18;--card2:#10231f;--line:#1e3b34;
  --txt:#f4fffb;--muted:#9fb8af;--accent:#4ee0b6;--accent2:#24b98f;
  --danger:#ff6f7d;--ok:#65e7a6;
}
*{box-sizing:border-box}
body{margin:0;background:
radial-gradient(circle at 50% -20%,#163e34 0,transparent 42%),
linear-gradient(180deg,#06100d,#091713);
font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--txt);min-height:100vh}
.wrap{max-width:520px;margin:0 auto;padding:24px 16px 42px}
.brand{text-align:center;padding:12px 0 22px}
.mark{width:68px;height:68px;border-radius:20px;margin:0 auto 12px;display:grid;place-items:center;
font-size:32px;font-weight:900;color:#05251d;background:linear-gradient(145deg,var(--accent),#a1ffe4);
box-shadow:0 12px 40px rgba(78,224,182,.2)}
.brand h1{margin:0;font-size:27px;letter-spacing:-.7px}
.brand p{margin:6px 0 0;color:var(--muted);font-size:14px}
.panel{background:rgba(13,27,24,.94);border:1px solid var(--line);border-radius:22px;padding:18px;
box-shadow:0 18px 55px rgba(0,0,0,.25);margin-bottom:14px}
.title{font-size:17px;font-weight:800;margin-bottom:5px}
.sub{font-size:13px;color:var(--muted);line-height:1.45}
.plans{display:grid;gap:10px;margin-top:15px}
.plan{width:100%;text-align:left;border:1px solid var(--line);background:var(--card2);color:var(--txt);
border-radius:17px;padding:15px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer}
.plan:active{transform:scale(.99)}
.plan strong{display:block;font-size:16px}.plan small{color:var(--muted)}
.price{font-weight:900;color:var(--accent);white-space:nowrap;font-size:18px}
.field{margin-top:13px}.field label{display:block;color:var(--muted);font-size:12px;margin:0 0 6px 2px}
input{width:100%;border:1px solid var(--line);background:#071411;color:var(--txt);border-radius:14px;padding:13px;font-size:15px;outline:none}
input:focus{border-color:var(--accent2)}
.btn{border:0;border-radius:14px;padding:13px 16px;font-size:15px;font-weight:850;cursor:pointer}
.btn-main{width:100%;background:var(--accent);color:#05251d;margin-top:12px}
.btn-soft{width:100%;background:#17332c;color:var(--txt);border:1px solid var(--line)}
.hidden{display:none!important}
.qr{width:min(270px,80vw);aspect-ratio:1;display:block;margin:15px auto;border-radius:16px;background:#fff;padding:9px}
.pix-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
.center{text-align:center}.status{font-weight:850;margin:10px 0 4px}.pending{color:#ffd77a}.approved{color:var(--ok)}.error{color:var(--danger)}
.timer{font-size:12px;color:var(--muted);margin-top:9px}
.badge{display:inline-flex;padding:6px 9px;border:1px solid var(--line);border-radius:99px;color:var(--muted);font-size:11px;margin-top:8px}
.footer{text-align:center;color:#729088;font-size:11px;padding-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <div class="mark">⌁</div>
    <h1>Open Wi-Fi</h1>
    <p>Escolha seu acesso, pague via Pix e conecte.</p>
  </div>

  <section class="panel" id="loading">
    <div class="title">Identificando aparelho...</div>
    <div class="sub" id="loadingText">Aguarde alguns segundos.</div>
  </section>

  <section class="panel hidden" id="plansBox">
    <div class="title">Escolha seu plano</div>
    <div class="sub">O acesso será liberado automaticamente neste aparelho após a confirmação.</div>
    <div class="plans" id="plans"></div>
  </section>

  <section class="panel hidden" id="checkoutBox">
    <div class="title" id="checkoutTitle">Finalizar compra</div>
    <div class="sub" id="checkoutSub"></div>
    <div class="field">
      <label>E-mail do pagador</label>
      <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="seuemail@exemplo.com">
    </div>
    <button class="btn btn-main" id="createPix">Gerar Pix</button>
    <button class="btn btn-soft" style="margin-top:8px" id="backPlans">Voltar aos planos</button>
    <div class="sub error hidden" style="margin-top:10px" id="checkoutError"></div>
  </section>

  <section class="panel hidden center" id="pixBox">
    <div class="title">Pague com Pix</div>
    <div class="sub" id="pixPlan"></div>
    <img class="qr" id="qr" alt="QR Code Pix">
    <div class="field" style="text-align:left">
      <label>Pix Copia e Cola</label>
      <input class="pix-code" id="pixCode" readonly>
    </div>
    <button class="btn btn-main" id="copyPix">Copiar Pix</button>
    <div class="status pending" id="payStatus">Aguardando pagamento...</div>
    <div class="timer" id="timer"></div>
    <div class="badge">Esta página pode permanecer aberta após a liberação.</div>
  </section>

  <section class="panel hidden center" id="successBox">
    <div style="font-size:42px">✓</div>
    <div class="title approved" style="font-size:21px">Pagamento confirmado</div>
    <div class="sub" id="successText">Seu acesso está sendo liberado na rede.</div>
  </section>

  <div class="footer">Open Wi-Fi • acesso automatizado</div>
</div>

<script>
const qs = new URLSearchParams(location.search);
const siteId = qs.get("site") || "openwifi-main";
const mac = (qs.get("mac") || "").toUpperCase();
const ip = qs.get("ip") || "";
const DEVICE_KEY = "openwifi_device_id_v1";

let deviceId = localStorage.getItem(DEVICE_KEY);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, deviceId);
}
let selectedPlan = null;
let currentPayment = null;
let pollTimer = null;
let countdownTimer = null;

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
const brl = (c) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(c/100);
const duration = (s) => {
  if (s === 3600) return "1 hora";
  if (s === 86400) return "1 dia";
  if (s === 604800) return "1 semana";
  if (s === 2592000) return "30 dias";
  return Math.round(s/3600) + " h";
};

async function api(path, options={}) {
  const r = await fetch(path, {
    ...options,
    headers: {"content-type":"application/json", ...(options.headers||{})}
  });
  const data = await r.json().catch(()=>({}));
  if (!r.ok) {
    const e = new Error(data.message || data.error || "Erro");
    e.data = data;
    throw e;
  }
  return data;
}

async function boot() {
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
    $("loadingText").textContent = "Abra esta página através da rede Open Wi-Fi.";
    return;
  }

  try {
    const reg = await api("/api/device/register", {
      method:"POST",
      body:JSON.stringify({siteId,mac,ip,deviceId})
    });
    deviceId = reg.deviceId;
    localStorage.setItem(DEVICE_KEY, deviceId);

    if (reg.activeUntil && reg.activeUntil > Date.now()) {
      hide("loading"); show("successBox");
      $("successText").textContent = "Este aparelho já possui acesso ativo.";
      return;
    }

    const data = await api("/api/plans?site="+encodeURIComponent(siteId));
    renderPlans(data.plans);
    hide("loading"); show("plansBox");
  } catch(e) {
    $("loadingText").textContent = e.message;
  }
}

function renderPlans(plans) {
  $("plans").innerHTML = "";
  for (const p of plans) {
    const b = document.createElement("button");
    b.className = "plan";
    b.innerHTML = '<span><strong>'+escapeHtml(p.name)+'</strong><small>'+duration(p.duration_seconds)+'</small></span><span class="price">'+brl(p.price_cents)+'</span>';
    b.onclick = () => choosePlan(p);
    $("plans").appendChild(b);
  }
}

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m]));
}

function choosePlan(p) {
  selectedPlan = p;
  $("checkoutTitle").textContent = p.name + " • " + brl(p.price_cents);
  $("checkoutSub").textContent = "Acesso válido por " + duration(p.duration_seconds) + " após a confirmação.";
  hide("plansBox"); show("checkoutBox");
}

$("backPlans").onclick = () => {
  hide("checkoutBox"); show("plansBox");
};

$("createPix").onclick = async () => {
  $("checkoutError").classList.add("hidden");
  const email = $("email").value.trim().toLowerCase();
  if (!email) {
    $("checkoutError").textContent = "Informe o e-mail do pagador.";
    $("checkoutError").classList.remove("hidden");
    return;
  }

  $("createPix").disabled = true;
  $("createPix").textContent = "Gerando...";

  try {
    const data = await api("/api/payments/create", {
      method:"POST",
      body:JSON.stringify({siteId,deviceId,planId:selectedPlan.id,mac,ip,email})
    });
    currentPayment = data.payment;
    renderPix(data.payment);
  } catch(e) {
    $("checkoutError").textContent = e.message;
    $("checkoutError").classList.remove("hidden");
  } finally {
    $("createPix").disabled = false;
    $("createPix").textContent = "Gerar Pix";
  }
};

function renderPix(p) {
  hide("checkoutBox"); hide("plansBox"); show("pixBox");
  $("pixPlan").textContent = p.planName + " • " + brl(p.amountCents);
  $("pixCode").value = p.qrCode || "";
  if (p.qrCodeBase64) $("qr").src = "data:image/png;base64," + p.qrCodeBase64;

  startAttemptTimer(p.attemptWindowUntil);
  startPolling(p.id);
}

$("copyPix").onclick = async () => {
  const value = $("pixCode").value;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    $("pixCode").select();
    document.execCommand("copy");
  }
  const old = $("copyPix").textContent;
  $("copyPix").textContent = "Pix copiado ✓";
  setTimeout(() => $("copyPix").textContent = old, 1800);
};

function startAttemptTimer(until) {
  clearInterval(countdownTimer);
  const tick = () => {
    const left = Number(until||0) - Date.now();
    if (left <= 0) {
      $("timer").textContent = "Janela inicial encerrada. O QR Pix continua válido até o vencimento da cobrança.";
      clearInterval(countdownTimer);
      return;
    }
    $("timer").textContent = "Janela inicial: " + Math.ceil(left/1000) + " s";
  };
  tick();
  countdownTimer = setInterval(tick, 500);
}

function startPolling(id) {
  clearInterval(pollTimer);
  const poll = async () => {
    try {
      const data = await api("/api/payments/" + encodeURIComponent(id));
      currentPayment = data.payment;
      const s = data.payment.status;

      if (s === "approved") {
        clearInterval(pollTimer);
        clearInterval(countdownTimer);
        hide("pixBox"); show("successBox");
        $("successText").textContent = data.access?.ends_at
          ? "Internet liberada. Acesso válido até " + new Date(data.access.ends_at).toLocaleString("pt-BR") + "."
          : "Pagamento confirmado. A rede está liberando este aparelho.";
      } else if (["failed","expired","cancelled","refunded"].includes(s)) {
        clearInterval(pollTimer);
        $("payStatus").className = "status error";
        $("payStatus").textContent = "Cobrança encerrada: " + s;
      } else {
        $("payStatus").className = "status pending";
        $("payStatus").textContent = "Aguardando confirmação do Pix...";
      }
    } catch {}
  };
  poll();
  pollTimer = setInterval(poll, 2500);
}

boot();
</script>
</body>
</html>`;
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
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/") {
      return new Response(
        [
          "Open Wi-Fi Cloudflare v1.0 Phase 2A",
          "",
          "Portal: /portal",
          "Health: /health",
          "Site: /api/site/status",
        ].join("\n"),
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (request.method === "GET" && path === "/health") return health(env);
    if (request.method === "GET" && path === "/portal") return html(portalPage(env));
    if (request.method === "GET" && path === "/api/site/status") return siteStatus(env);
    if (request.method === "GET" && path === "/api/plans") return listPlans(url, env);

    if (request.method === "POST" && path === "/api/device/register") {
      return registerDevice(request, env);
    }

    if (request.method === "POST" && path === "/api/payments/create") {
      return createPayment(request, env);
    }

    const paymentMatch = path.match(/^\/api\/payments\/([0-9a-fA-F-]{36})$/);
    if (request.method === "GET" && paymentMatch) {
      return paymentStatus(url, env, paymentMatch[1]);
    }

    if (request.method === "POST" && path === "/api/mercadopago/webhook") {
      return mercadoPagoWebhook(request, url, env, ctx);
    }

    if (request.method === "POST" && path === "/api/router/poll") {
      return routerPoll(request, env);
    }

    if (request.method === "POST" && path === "/api/router/ack") {
      return routerAck(request, env);
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
