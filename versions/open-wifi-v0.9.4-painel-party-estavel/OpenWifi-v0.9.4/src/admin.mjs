import crypto from 'node:crypto';
import { allPlanCatalog, planFromAttempt } from './plans.mjs';
import { normalizeMac } from './mikrotik.mjs';

function now() { return Date.now(); }
function numEnv(name, fallback = 0) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function timezone() { return process.env.ADMIN_TIMEZONE || 'America/Sao_Paulo'; }

function dateParts(ts) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(), year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(ts));
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}

function sameLocalDay(a, b) {
  const x = dateParts(a), y = dateParts(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function sameLocalMonth(a, b) {
  const x = dateParts(a), y = dateParts(b);
  return x.year === y.year && x.month === y.month;
}

function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function groupViewUrl(token) {
  if (!token) return '';
  const base = String(process.env.PARTY_GROUP_VIEW_BASE_URL || 'https://open-wi-fi-ofc.web.app/group.html').trim();
  return `${base}${base.includes('?') ? '&' : '?'}g=${encodeURIComponent(token)}`;
}


function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function secret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function makeToken(username) {
  const exp = Date.now() + numEnv('ADMIN_SESSION_HOURS', 12) * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ u: username, exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  return Object.fromEntries(raw.split(';').map(x => x.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return i >= 0 ? [decodeURIComponent(part.slice(0, i)), decodeURIComponent(part.slice(i + 1))] : [part, ''];
  }));
}

function verifyToken(token) {
  if (!token || !secret()) return false;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Boolean(data?.u && data.exp > Date.now());
  } catch { return false; }
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_USER?.trim() && process.env.ADMIN_PASSWORD?.trim());
}

export function loginAdmin(username, password) {
  if (!adminConfigured()) return null;
  if (!safeEqual(username, process.env.ADMIN_USER) || !safeEqual(password, process.env.ADMIN_PASSWORD)) return null;
  return makeToken(username);
}

export function adminAuth(req, res, next) {
  if (!adminConfigured()) return res.status(503).json({ error: 'Painel admin não configurado. Defina ADMIN_USER e ADMIN_PASSWORD no .env.' });
  if (!verifyToken(parseCookies(req).ow_admin)) return res.status(401).json({ error: 'Não autenticado' });
  next();
}

export function adminPageAuth(req, res, next) {
  if (!adminConfigured()) return res.redirect('/admin-login.html?setup=1');
  if (!verifyToken(parseCookies(req).ow_admin)) return res.redirect('/admin-login.html');
  next();
}

export function adminCookie(token) {
  const secure = String(process.env.ADMIN_COOKIE_SECURE || '').toLowerCase() === 'true';
  return `ow_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.round(numEnv('ADMIN_SESSION_HOURS', 12) * 3600)}${secure ? '; Secure' : ''}`;
}

export function clearAdminCookie() {
  return 'ow_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
}

function normalizeDeviceId(deviceId) {
  const value = String(deviceId || '');
  const mac = normalizeMac(value);
  return mac || normalizeMac(value.replace(/^MAC:/i, '')) || null;
}

function planInfo(id) {
  const p = allPlanCatalog()[id];
  return p ? { id, label: p.label, amount: p.amount } : { id: id || '-', label: id || '-', amount: 0 };
}

export class AdminDashboardService {
  constructor(store, network) {
    this.store = store;
    this.network = network;
  }

  async snapshot() {
    const t = now();
    const raw = this.store.read(data => structuredClone(data));
    raw.identities ||= {};
    const attempts = Object.values(raw.attempts || {});
    const approved = attempts.filter(a => a.status === 'approved' && a.approvedAt);

    let network = { hosts: [], leases: [], routerOnline: false, routerError: null };
    try {
      network = await this.network.dashboardNetworkSnapshot();
    } catch (error) {
      network.routerError = error.message;
    }

    const leasesByMac = new Map();
    for (const lease of network.leases || []) {
      const mac = normalizeMac(lease['mac-address']);
      if (mac) leasesByMac.set(mac, lease);
    }
    const hostsByMac = new Map();
    for (const host of network.hosts || []) {
      const mac = normalizeMac(host['mac-address']);
      if (mac) hostsByMac.set(mac, host);
    }

    const identityOfAttempt = a => String(a.identityId || a.deviceId || '');
    const latestApprovedByIdentity = new Map();
    for (const a of approved.slice().sort((a,b) => (b.approvedAt||0)-(a.approvedAt||0))) {
      const id = identityOfAttempt(a);
      if (id && !latestApprovedByIdentity.has(id)) latestApprovedByIdentity.set(id, a);
    }

    // Um Device ID lógico pode representar vários MACs. Mantemos o agrupamento
    // e usamos um ID sintético por MAC para clientes antigos ou ainda não vinculados.
    const macsByIdentity = new Map();
    const addMac = (identityId, value) => {
      const mac = normalizeDeviceId(value);
      if (!identityId || !mac) return;
      const set = macsByIdentity.get(identityId) || new Set();
      set.add(mac);
      macsByIdentity.set(identityId, set);
    };

    for (const [identityId, identity] of Object.entries(raw.identities)) {
      for (const deviceId of identity.deviceIds || []) addMac(identityId, deviceId);
    }
    for (const a of attempts) addMac(identityOfAttempt(a), a.deviceId);

    const mappedMacs = new Set([...macsByIdentity.values()].flatMap(set => [...set]));
    const allNetworkMacs = new Set([...hostsByMac.keys(), ...leasesByMac.keys()]);
    for (const mac of allNetworkMacs) {
      if (!mappedMacs.has(mac)) addMac(`MAC:${mac}`, `MAC:${mac}`);
    }

    const identityIds = new Set([...Object.keys(raw.identities), ...macsByIdentity.keys(), ...latestApprovedByIdentity.keys()]);
    const clients = [...identityIds].map(identityId => {
      const identity = raw.identities?.[identityId] || {};
      const last = latestApprovedByIdentity.get(identityId) || null;
      const macs = [...(macsByIdentity.get(identityId) || new Set())];
      if (!macs.length) {
        const fallback = normalizeDeviceId(identityId);
        if (fallback) macs.push(fallback);
      }

      const onlineMacs = macs.filter(mac => hostsByMac.has(mac));
      const primaryMac = onlineMacs[0] || macs[0] || '-';
      const primaryHost = hostsByMac.get(primaryMac) || {};
      const primaryLease = leasesByMac.get(primaryMac) || {};
      const anyNamedLease = macs.map(mac => leasesByMac.get(mac)).find(l => l?.['host-name'] || l?.comment) || {};

      let accessUntil = Number(identity.accessUntil || last?.accessUntil || 0);
      for (const mac of macs) {
        const d = raw.devices?.[`MAC:${mac}`] || raw.devices?.[mac] || {};
        accessUntil = Math.max(accessUntil, Number(d.accessUntil || 0));
      }
      const plan = planInfo(last?.plan || identity.lastApprovedPlan);
      const ips = macs.map(mac => {
        const host = hostsByMac.get(mac) || {};
        const lease = leasesByMac.get(mac) || {};
        return host.address || host['to-address'] || lease['active-address'] || lease.address || null;
      }).filter(Boolean);

      return {
        deviceKey: identityId,
        identityId,
        hostname: primaryLease['host-name'] || primaryLease.comment || anyNamedLease['host-name'] || anyNamedLease.comment || 'Dispositivo sem nome',
        mac: primaryMac,
        macs,
        macCount: macs.length,
        ip: primaryHost.address || primaryHost['to-address'] || primaryLease['active-address'] || primaryLease.address || ips[0] || '-',
        ips,
        online: onlineMacs.length > 0,
        onlineLinks: onlineMacs.length,
        paidActive: accessUntil > t,
        email: identity.email || last?.email || '-',
        plan: plan.label,
        planId: plan.id,
        accessUntil: accessUntil || null,
        lastPurchaseAt: last?.approvedAt || null,
        networkAccess: last?.networkAccess || null
      };
    }).sort((a,b) => Number(b.online)-Number(a.online) || Number(b.paidActive)-Number(a.paidActive) || (b.lastPurchaseAt||0)-(a.lastPurchaseAt||0));

    const todayApproved = approved.filter(a => sameLocalDay(a.approvedAt, t));
    const monthApproved = approved.filter(a => sameLocalMonth(a.approvedAt, t));
    const grossToday = todayApproved.reduce((sum,a) => sum + Number(a.amount ?? planFromAttempt(a)?.amount ?? 0), 0);
    const grossMonth = monthApproved.reduce((sum,a) => sum + Number(a.amount ?? planFromAttempt(a)?.amount ?? 0), 0);
    const feePercent = numEnv('MP_FEE_PERCENT', 0);
    const monthlyFixedCost = numEnv('MONTHLY_FIXED_COST', 0);
    const estimatedFeesMonth = grossMonth * feePercent / 100;
    const estimatedProfitMonth = grossMonth - estimatedFeesMonth - monthlyFixedCost;

    const purchases = approved.slice().sort((a,b) => (b.approvedAt||0)-(a.approvedAt||0)).slice(0, 100).map(a => {
      const identityId = identityOfAttempt(a);
      const mac = normalizeDeviceId(a.deviceId) || String(a.deviceId || '-');
      const lease = leasesByMac.get(mac) || {};
      const host = hostsByMac.get(mac) || {};
      const identity = raw.identities?.[identityId] || {};
      return {
        id: a.id,
        identityId,
        approvedAt: a.approvedAt,
        email: a.email || identity.email || '-',
        hostname: lease['host-name'] || lease.comment || 'Dispositivo sem nome',
        mac,
        macCount: (identity.deviceIds || []).length || 1,
        ip: host.address || host['to-address'] || lease['active-address'] || lease.address || '-',
        plan: a.planLabel || planFromAttempt(a)?.label || a.plan,
        amount: Number(a.amount ?? planFromAttempt(a)?.amount ?? 0),
        accessUntil: a.accessUntil || null,
        orderId: a.orderId || null,
        networkAccess: a.networkAccess || null,
        mode: a.mode || 'standard',
        eventId: a.eventId || null,
        whatsappMasked: a.whatsapp ? `${String(a.whatsapp).slice(0,4)}••••${String(a.whatsapp).slice(-4)}` : '-',
        comboId: a.comboId || null
      };
    });

    const settings = raw.settings || { mode: 'standard', currentEvent: null };
    const currentEvent = settings.currentEvent || null;
    const eventApproved = currentEvent ? approved.filter(a => a.eventId === currentEvent.id) : [];
    const eventGross = eventApproved.reduce((sum,a) => sum + Number(a.amount ?? planFromAttempt(a)?.amount ?? 0), 0);
    const clientsByIdentity = new Map(clients.map(c => [String(c.identityId || c.deviceKey || ''), c]));
    const combos = Object.values(raw.combos || {}).filter(c => !currentEvent || c.eventId === currentEvent.id).map(c => ({
      id: c.id,
      code: c.code,
      label: c.label || c.type,
      maxDevices: c.maxDevices || 0,
      usedDevices: (c.members || []).length,
      availableSlots: Math.max(0, Number(c.maxDevices || 0) - (c.members || []).length),
      expiresAt: c.expiresAt || null,
      status: c.status || 'active',
      eventId: c.eventId || null,
      eventName: c.eventName || null,
      whatsapp: c.whatsapp || '',
      whatsappMasked: c.whatsapp ? `${String(c.whatsapp).slice(0,4)}••••${String(c.whatsapp).slice(-4)}` : '-',
      viewUrl: groupViewUrl(c.viewToken),
      membersImmutable: true,
      members: (c.members || []).map((m, index) => {
        const client = clientsByIdentity.get(String(m.identityId || '')) || {};
        return {
          position: index + 1,
          identityId: m.identityId || '',
          role: m.role || 'guest',
          name: client.hostname || `Aparelho ${index + 1}`,
          online: Boolean(client.online),
          joinedAt: m.joinedAt || null,
          macCount: Number(client.macCount || (m.deviceIds || []).length || 1)
        };
      })
    })).sort((a,b) => Number(b.expiresAt||0)-Number(a.expiresAt||0));

    return {
      mode: settings.mode || 'standard',
      event: currentEvent,
      party: { purchases: eventApproved.length, gross: money(eventGross), combos },
      generatedAt: t,
      timezone: timezone(),
      router: {
        online: Boolean(network.routerOnline),
        error: network.routerError || null,
        connectedHosts: (network.hosts || []).length
      },
      metrics: {
        connectedNow: clients.filter(c => c.online).length,
        paidOnlineNow: clients.filter(c => c.online && c.paidActive).length,
        activePaidAccesses: clients.filter(c => c.paidActive).length,
        purchasesToday: todayApproved.length,
        grossToday: money(grossToday),
        purchasesMonth: monthApproved.length,
        grossMonth: money(grossMonth),
        feePercent,
        estimatedFeesMonth: money(estimatedFeesMonth),
        monthlyFixedCost: money(monthlyFixedCost),
        estimatedProfitMonth: money(estimatedProfitMonth)
      },
      clients,
      purchases
    };
  }}
