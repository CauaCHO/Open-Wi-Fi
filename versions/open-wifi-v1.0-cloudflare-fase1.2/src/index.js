const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });

const normalizeMac = (mac = "") =>
  String(mac).trim().toUpperCase().replace(/-/g, ":");

const bearer = (request) => {
  const h = request.headers.get("authorization") || "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
};

const safeJsonParse = (value) => {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
};

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
    version: "1.0.0-phase1.2",
    time: new Date().toISOString(),
  });
}

/**
 * Sincroniza snapshot de hosts no D1 com poucas escritas.
 * A função só é chamada na janela de heartbeat (~30 s), não a cada poll.
 *
 * - host novo            => INSERT
 * - IP/hostname mudou    => UPDATE
 * - last_seen muito velho=> UPDATE periódico
 * - host sumiu           => DELETE
 *
 * A presença da linha em router_hosts representa o snapshot atual.
 */
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
    if (!mac) continue;

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
    // D1 Free permite até 50 queries por invocation.
    // Em eventos grandes, quebramos em lotes para não exceder o limite
    // e deixamos no máximo 20 operações de host por heartbeat.
    // O restante converge nos heartbeats seguintes.
    const slice = statements.slice(0, 20);
    await env.DB.batch(slice);
  }

  return {
    incomingCount: incoming.size,
    storedCount: existing.size,
    changesQueued: statements.length,
    changesApplied: Math.min(statements.length, 20),
  };
}

async function routerPoll(request, env) {
  if (!(await requireRouter(request, env))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

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

  // Cada grant muda para expired somente uma vez.
  await env.DB.prepare(`
    UPDATE access_grants
       SET status = 'expired',
           updated_at = ?
     WHERE site_id = ?
       AND status = 'active'
       AND ends_at <= ?
  `).bind(now, siteId, now).run();

  // Lista desejada de MACs liberados neste instante.
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

  const commands = await env.DB.prepare(`
    SELECT id, type, mac, expires_at, payload_json
      FROM router_commands
     WHERE site_id = ?
       AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 10
  `).bind(siteId).all();

  // Nesta fase os commands continuam disponíveis, mas a sincronização
  // de access é a fonte principal para liberar/revogar.
  if (commands.results.length) {
    const deliveredAt = Date.now();
    await env.DB.batch(
      commands.results.map((c) =>
        env.DB.prepare(`
          UPDATE router_commands
             SET status = 'delivered',
                 delivered_at = ?
           WHERE id = ?
             AND status = 'pending'
        `).bind(deliveredAt, c.id)
      )
    );
  }

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
    commands: commands.results.map((c) => ({
      id: c.id,
      type: c.type,
      mac: c.mac ? normalizeMac(c.mac) : null,
      expiresAt: c.expires_at,
      payload: safeJsonParse(c.payload_json),
    })),
  });
}

async function routerAck(request, env) {
  if (!(await requireRouter(request, env))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map(String).slice(0, 25)
    : [];

  if (!ids.length) return json({ ok: true, acked: 0 });

  const now = Date.now();

  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare(`
        UPDATE router_commands
           SET status = 'acked',
               acked_at = ?
         WHERE id = ?
           AND status = 'delivered'
      `).bind(now, id)
    )
  );

  return json({ ok: true, acked: ids.length });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        [
          "Open Wi-Fi Cloudflare v1.0 Phase 1.2",
          "",
          "Health: /health",
          "Site: /api/site/status",
        ].join("\n"),
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return health(env);
    }

    if (request.method === "GET" && url.pathname === "/api/site/status") {
      return siteStatus(env);
    }

    if (request.method === "POST" && url.pathname === "/api/router/poll") {
      return routerPoll(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/router/ack") {
      return routerAck(request, env);
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
