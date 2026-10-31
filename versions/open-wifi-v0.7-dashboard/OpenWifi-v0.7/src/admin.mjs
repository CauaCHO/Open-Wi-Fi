import crypto from 'node:crypto';
import { PLANS } from './payments.mjs';
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
  const p = PLANS[id];
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

    const latestApprovedByMac = new Map();
    for (const a of approved.sort((a,b) => (b.approvedAt||0)-(a.approvedAt||0))) {
      const mac = normalizeDeviceId(a.deviceId);
      if (mac && !latestApprovedByMac.has(mac)) latestApprovedByMac.set(mac, a);
    }

    const allMacs = new Set([...hostsByMac.keys(), ...leasesByMac.keys(), ...latestApprovedByMac.keys()]);
    const clients = [...allMacs].map(mac => {
      const host = hostsByMac.get(mac) || {};
      const lease = leasesByMac.get(mac) || {};
      const last = latestApprovedByMac.get(mac) || null;
      const device = raw.devices?.[`MAC:${mac}`] || raw.devices?.[mac] || {};
      const accessUntil = Number(device.accessUntil || last?.accessUntil || 0);
      const plan = planInfo(last?.plan || device.lastApprovedPlan);
      return {
        hostname: lease['host-name'] || lease.comment || 'Dispositivo sem nome',
        mac,
        ip: host.address || host['to-address'] || lease['active-address'] || lease.address || '-',
        online: hostsByMac.has(mac),
        paidActive: accessUntil > t,
        email: last?.email || '-',
        plan: plan.label,
        planId: plan.id,
        accessUntil: accessUntil || null,
        lastPurchaseAt: last?.approvedAt || null,
        networkAccess: last?.networkAccess || null
      };
    }).sort((a,b) => Number(b.online)-Number(a.online) || Number(b.paidActive)-Number(a.paidActive) || (b.lastPurchaseAt||0)-(a.lastPurchaseAt||0));

    const todayApproved = approved.filter(a => sameLocalDay(a.approvedAt, t));
    const monthApproved = approved.filter(a => sameLocalMonth(a.approvedAt, t));
    const grossToday = todayApproved.reduce((sum,a) => sum + (PLANS[a.plan]?.amount || 0), 0);
    const grossMonth = monthApproved.reduce((sum,a) => sum + (PLANS[a.plan]?.amount || 0), 0);
    const feePercent = numEnv('MP_FEE_PERCENT', 0);
    const monthlyFixedCost = numEnv('MONTHLY_FIXED_COST', 0);
    const estimatedFeesMonth = grossMonth * feePercent / 100;
    const estimatedProfitMonth = grossMonth - estimatedFeesMonth - monthlyFixedCost;

    const purchases = approved.slice().sort((a,b) => (b.approvedAt||0)-(a.approvedAt||0)).slice(0, 100).map(a => {
      const mac = normalizeDeviceId(a.deviceId) || String(a.deviceId || '-');
      const lease = leasesByMac.get(mac) || {};
      const host = hostsByMac.get(mac) || {};
      return {
        id: a.id,
        approvedAt: a.approvedAt,
        email: a.email || '-',
        hostname: lease['host-name'] || lease.comment || 'Dispositivo sem nome',
        mac,
        ip: host.address || host['to-address'] || lease['active-address'] || lease.address || '-',
        plan: PLANS[a.plan]?.label || a.plan,
        amount: PLANS[a.plan]?.amount || 0,
        accessUntil: a.accessUntil || null,
        orderId: a.orderId || null,
        networkAccess: a.networkAccess || null
      };
    });

    return {
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
  }
}
