import net from 'node:net';
import { RouterOSApiClient } from './routeros-api.mjs';

const COMMENT_PREFIX = 'OWIFI|';

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function now() { return Date.now(); }

function normalizeMac(value) {
  const text = String(value || '').trim().toUpperCase().replace(/-/g, ':');
  const mac = text.startsWith('MAC:') ? text.slice(4) : text;
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) return null;
  return mac;
}

function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const percent = ip.indexOf('%');
  if (percent >= 0) ip = ip.slice(0, percent);
  return net.isIP(ip) ? ip : null;
}

function commentFor({ kind, mac, until, attemptId = '', plan = '' }) {
  const id = String(attemptId || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  return `${COMMENT_PREFIX}${kind}|${mac}|${Math.floor(until)}|${plan || '-'}|${id}`;
}

function parseComment(comment = '') {
  if (!comment.startsWith(COMMENT_PREFIX)) return null;
  const [, kind, mac, until, plan, attemptId] = comment.split('|');
  const parsedMac = normalizeMac(mac);
  const parsedUntil = Number(until);
  if (!kind || !parsedMac || !Number.isFinite(parsedUntil)) return null;
  return { kind, mac: parsedMac, until: parsedUntil, plan, attemptId };
}

export class MikroTikAccessService {
  constructor(store) {
    this.store = store;
    this.syncing = false;
  }

  mode() { return (process.env.MIKROTIK_MODE || 'mock').toLowerCase(); }
  isReal() { return this.mode() === 'real'; }

  client() {
    const useTls = envBool('MIKROTIK_USE_TLS', false);
    return new RouterOSApiClient({
      host: process.env.MIKROTIK_HOST || '192.168.88.1',
      port: Number(process.env.MIKROTIK_PORT || (useTls ? 8729 : 8728)),
      username: process.env.MIKROTIK_USER || '',
      password: process.env.MIKROTIK_PASSWORD || '',
      useTls,
      rejectUnauthorized: envBool('MIKROTIK_TLS_VERIFY', true),
      timeoutMs: Number(process.env.MIKROTIK_TIMEOUT_MS || 5000)
    });
  }

  assertConfigured() {
    if (!this.isReal()) return;
    const missing = ['MIKROTIK_HOST', 'MIKROTIK_USER', 'MIKROTIK_PASSWORD'].filter(key => !process.env[key]?.trim());
    if (missing.length) throw new Error(`MikroTik real sem configuração: ${missing.join(', ')}`);
  }

  async testConnection() {
    if (!this.isReal()) return { ok: true, mode: 'mock' };
    this.assertConfigured();
    const result = await this.client().command('/system/resource/print', { '.proplist': 'board-name,version,architecture-name' });
    return { ok: true, mode: 'real', router: result.rows[0] || {} };
  }

  async dashboardNetworkSnapshot() {
    if (!this.isReal()) return { routerOnline: false, hosts: [], leases: [], mode: 'mock' };
    this.assertConfigured();
    const client = this.client();
    const [hosts, leases] = await Promise.all([
      client.command('/ip/hotspot/host/print', { '.proplist': 'mac-address,address,to-address,authorized,bypassed,server' }),
      client.command('/ip/dhcp-server/lease/print', { '.proplist': 'mac-address,address,active-address,host-name,status,comment' })
    ]);
    return { routerOnline: true, hosts: hosts.rows || [], leases: leases.rows || [], mode: 'real' };
  }

  async resolveDeviceId({ claimedDeviceId, clientIp }) {
    if (!this.isReal()) return claimedDeviceId;
    this.assertConfigured();

    const validation = (process.env.MIKROTIK_DEVICE_VALIDATION || 'prefer-router').toLowerCase();
    const ip = normalizeIp(clientIp);
    const claimedMac = normalizeMac(claimedDeviceId);

    if (validation !== 'trust-portal' && ip) {
      try {
        const result = await this.client().command('/ip/hotspot/host/print', {
          '.proplist': 'mac-address,address,to-address,authorized,server'
        });
        const host = result.rows.find(row => row.address === ip || row['to-address'] === ip);
        const routerMac = normalizeMac(host?.['mac-address']);
        if (routerMac) {
          if (claimedMac && claimedMac !== routerMac) {
            console.warn(`[mikrotik] MAC informado ${claimedMac} diverge do host ${routerMac}; usando o MAC da RB.`);
          }
          return `MAC:${routerMac}`;
        }
      } catch (error) {
        if (validation === 'strict-router') throw new Error(`Não consegui validar o dispositivo pela RB: ${error.message}`);
        console.warn('[mikrotik] Não consegui resolver MAC pelo IP; tentando MAC informado pelo portal:', error.message);
      }
    }

    if (validation === 'strict-router') {
      throw Object.assign(new Error('Não foi possível identificar o MAC deste dispositivo pela MikroTik'), { httpStatus: 400 });
    }
    if (claimedMac) return `MAC:${claimedMac}`;
    throw Object.assign(new Error('MikroTik real exige um MAC válido. Abra o portal através do HotSpot da RB.'), { httpStatus: 400 });
  }

  async grantTemporary(deviceId, until, attemptId) {
    if (!this.isReal()) return { ok: true, mode: 'mock' };
    const mac = normalizeMac(deviceId);
    if (!mac) throw new Error('Não é possível liberar temporariamente: dispositivo sem MAC válido');
    const paidUntil = this.store.read(data => data.devices?.[deviceId]?.accessUntil || 0);
    if (paidUntil > now()) return { ok: true, skipped: 'paid-access-active', until: paidUntil };

    await this.#replaceBinding(mac, {
      kind: 'temp', until, attemptId,
      comment: commentFor({ kind: 'temp', mac, until, attemptId }),
      preservePaid: true
    });
    console.log(`[mikrotik] TEMP ${mac} liberado até ${new Date(until).toISOString()}`);
    return { ok: true, mac, until };
  }

  async endTemporary(deviceId) {
    if (!this.isReal()) return { ok: true, mode: 'mock' };
    const mac = normalizeMac(deviceId);
    if (!mac) return { ok: false, skipped: 'invalid-mac' };
    const bindings = await this.#openWifiBindings();
    for (const binding of bindings.filter(b => b.meta?.mac === mac && b.meta?.kind === 'temp')) {
      await this.#removeBinding(binding['.id']);
    }
    console.log(`[mikrotik] TEMP ${mac} encerrado`);
    return { ok: true, mac };
  }

  async grantPaid(deviceId, until, attemptId, plan) {
    if (!this.isReal()) return { ok: true, mode: 'mock', until };
    const mac = normalizeMac(deviceId);
    if (!mac) throw new Error('Pagamento aprovado, mas o dispositivo não possui MAC válido');

    await this.#replaceBinding(mac, {
      kind: 'paid', until, attemptId, plan,
      comment: commentFor({ kind: 'paid', mac, until, attemptId, plan }),
      preservePaid: false
    });
    console.log(`[mikrotik] PAGO ${mac} liberado até ${new Date(until).toISOString()} (${plan})`);
    return { ok: true, mac, until };
  }

  async revokeDevice(deviceId) {
    if (!this.isReal()) return { ok: true, mode: 'mock' };
    const mac = normalizeMac(deviceId);
    if (!mac) return { ok: false, skipped: 'invalid-mac' };
    const bindings = await this.#openWifiBindings();
    for (const binding of bindings.filter(b => b.meta?.mac === mac)) await this.#removeBinding(binding['.id']);
    console.log(`[mikrotik] ${mac} removido do bypass Open Wi-Fi`);
    return { ok: true, mac };
  }

  async reconcile() {
    if (!this.isReal() || this.syncing) return;
    this.syncing = true;
    try {
      this.assertConfigured();
      const t = now();
      const bindings = await this.#openWifiBindings();

      // A RB não expira ip-binding sozinha. Removemos qualquer binding Open Wi-Fi vencido.
      for (const binding of bindings) {
        if (binding.meta && binding.meta.until <= t) await this.#removeBinding(binding['.id']);
      }

      // Se o backend/rede reiniciou, restaura acessos pagos ainda válidos a partir do store.
      const active = this.store.read(data => Object.entries(data.devices || {})
        .filter(([, d]) => Number(d.accessUntil || 0) > t)
        .map(([deviceId, d]) => ({ deviceId, until: Number(d.accessUntil), attemptId: d.lastApprovedAttempt || '', plan: d.lastApprovedPlan || '-' })));

      const refreshed = await this.#openWifiBindings();
      for (const grant of active) {
        const mac = normalizeMac(grant.deviceId);
        if (!mac) continue;
        const existing = refreshed.find(b => b.meta?.mac === mac && b.meta?.kind === 'paid' && b.meta.until >= grant.until - 1000);
        if (!existing) await this.grantPaid(grant.deviceId, grant.until, grant.attemptId, grant.plan);
        if (grant.attemptId) {
          await this.store.mutate(async data => {
            const attempt = data.attempts?.[grant.attemptId];
            if (attempt?.status === 'approved') {
              attempt.networkAccess = 'active';
              attempt.networkError = null;
              attempt.networkSyncedAt = now();
            }
          });
        }
      }
    } catch (error) {
      console.error('[mikrotik/reconcile]', error.message);
    } finally {
      this.syncing = false;
    }
  }

  async #replaceBinding(mac, { kind, until, attemptId, plan, comment, preservePaid }) {
    const bindings = await this.#openWifiBindings();
    if (preservePaid) {
      const paid = bindings.find(b => b.meta?.mac === mac && b.meta?.kind === 'paid' && b.meta.until > now());
      if (paid) return;
    }
    for (const binding of bindings.filter(b => b.meta?.mac === mac)) await this.#removeBinding(binding['.id']);
    await this.client().command('/ip/hotspot/ip-binding/add', {
      'mac-address': mac,
      type: 'bypassed',
      server: process.env.MIKROTIK_HOTSPOT_SERVER || 'all',
      comment
    });
  }

  async #openWifiBindings() {
    const result = await this.client().command('/ip/hotspot/ip-binding/print', {
      '.proplist': '.id,mac-address,type,server,comment'
    });
    return result.rows
      .filter(row => String(row.comment || '').startsWith(COMMENT_PREFIX))
      .map(row => ({ ...row, meta: parseComment(row.comment) }));
  }

  async #removeBinding(id) {
    if (!id) return;
    await this.client().command('/ip/hotspot/ip-binding/remove', { '.id': id });
  }
}

export { normalizeMac };
