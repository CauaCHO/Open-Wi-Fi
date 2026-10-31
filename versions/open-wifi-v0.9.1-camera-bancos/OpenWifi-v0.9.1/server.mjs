import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebhookSignatureValidator } from 'mercadopago';
import { loadDotEnv } from './src/env.mjs';
import { JsonStore } from './src/store.mjs';
import { PaymentService } from './src/payments.mjs';
import { MikroTikAccessService } from './src/mikrotik.mjs';
import { AdminDashboardService, adminAuth, adminPageAuth, loginAdmin, adminCookie, clearAdminCookie, adminConfigured } from './src/admin.mjs';
import { FirebaseSyncService } from './src/firebase-sync.mjs';
import { PartyService } from './src/party.mjs';
import { WhatsAppService } from './src/whatsapp.mjs';

loadDotEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8080);
const store = new JsonStore(path.join(__dirname, 'data/store.json'));
const network = new MikroTikAccessService(store);
const whatsapp = new WhatsAppService();
const party = new PartyService(store, network, whatsapp);
const payments = new PaymentService(store, network, party);
const dashboard = new AdminDashboardService(store, network);
const firebaseSync = new FirebaseSyncService(dashboard, party);


function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return i >= 0 ? [decodeURIComponent(part.slice(0, i)), decodeURIComponent(part.slice(i + 1))] : [part, ''];
  }));
}

function deviceIdentitySecret() {
  return process.env.DEVICE_ID_SECRET?.trim() || process.env.ADMIN_SESSION_SECRET?.trim() || 'openwifi-local-dev-secret-change-me';
}

function signDeviceUuid(uuid) {
  return crypto.createHmac('sha256', deviceIdentitySecret()).update(uuid).digest('base64url');
}

function parseDeviceToken(raw) {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]+)$/i.exec(String(raw || ''));
  const uuid = match?.[1] || '';
  const signature = match?.[2] || '';
  const expected = uuid ? signDeviceUuid(uuid) : '';
  const valid = Boolean(uuid && signature && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)));
  return valid ? { uuid, token: `${uuid}.${signature}` } : null;
}

function ensureDeviceIdentity(req, res, resumeToken = '') {
  const fromCookie = parseDeviceToken(parseCookies(req).ow_device || '');
  const fromResume = parseDeviceToken(resumeToken);
  const resolved = fromCookie || fromResume;
  const uuid = resolved?.uuid || crypto.randomUUID();
  const token = resolved?.token || `${uuid}.${signDeviceUuid(uuid)}`;

  // Renova o cookie inclusive quando a identidade foi recuperada pelo token
  // guardado no localStorage do portal.
  res.append('Set-Cookie', `ow_device=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  return { identityId: `OWD:${uuid}`, resumeToken: token };
}

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.get('/health', (_req, res) => {
  res.json({ ok: true, version: '0.9.0', paymentsMode: process.env.PAYMENTS_MODE || 'mock', mikrotikMode: process.env.MIKROTIK_MODE || 'mock', firebase: firebaseSync.status() });
});

app.get('/api/plans', (_req, res) => res.json(payments.getPlans()));
app.get('/api/site', (_req, res) => res.json(party.publicConfig()));

// Painel administrativo
app.post('/api/admin/login', (req, res) => {
  if (!adminConfigured()) return res.status(503).json({ error: 'Defina ADMIN_USER e ADMIN_PASSWORD no .env.' });
  const token = loginAdmin(String(req.body.username || ''), String(req.body.password || ''));
  if (!token) return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  res.setHeader('Set-Cookie', adminCookie(token));
  res.json({ ok: true });
});
app.post('/api/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearAdminCookie());
  res.json({ ok: true });
});
app.get('/api/admin/dashboard', adminAuth, async (_req, res, next) => {
  try { res.json(await dashboard.snapshot()); }
  catch (error) { next(error); }
});
app.get('/api/admin/firebase', adminAuth, (_req, res) => res.json(firebaseSync.status()));
app.post('/api/admin/firebase/sync', adminAuth, async (_req, res, next) => {
  try { res.json(await firebaseSync.syncNow() || { ok: true, skipped: true }); }
  catch (error) { next(error); }
});
app.get('/api/admin/party', adminAuth, (_req, res) => res.json({ ...party.settings(), combos: party.listCombos() }));
app.put('/api/admin/party', adminAuth, async (req, res, next) => {
  try {
    const result = await party.setMode({ mode: req.body.mode, event: req.body.event || null, source: 'local-admin' });
    await firebaseSync.syncNow().catch(() => {});
    res.json(result);
  } catch (error) { next(error); }
});
app.post('/api/admin/party/combos/:id/resend', adminAuth, async (req, res, next) => {
  try { res.json(await party.resendInvite(req.params.id)); } catch (error) { next(error); }
});
app.get('/admin', adminPageAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/admin.html', adminPageAuth, (_req, res) => res.redirect('/admin'));

// Arquivos públicos do portal e assets do painel. As APIs administrativas continuam protegidas.
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.post('/api/device/session', async (req, res, next) => {
  try {
    const identity = ensureDeviceIdentity(req, res, String(req.body.resumeToken || ''));
    const deviceId = await network.resolveDeviceId({
      claimedDeviceId: String(req.body.deviceId || ''),
      clientIp: req.ip || req.socket?.remoteAddress || ''
    });
    const state = await payments.registerIdentity({
      identityId: identity.identityId,
      deviceId,
      email: String(req.body.email || ''),
      whatsapp: String(req.body.whatsapp || '')
    });
    res.json({ ...state, resumeToken: identity.resumeToken });
  } catch (error) { next(error); }
});

app.post('/api/attempts', async (req, res, next) => {
  try {
    const identity = ensureDeviceIdentity(req, res, String(req.body.resumeToken || ''));
    const deviceId = await network.resolveDeviceId({
      claimedDeviceId: String(req.body.deviceId || ''),
      clientIp: req.ip || req.socket?.remoteAddress || ''
    });
    const result = await payments.createAttempt({
      deviceId,
      identityId: identity.identityId,
      plan: String(req.body.plan || ''),
      email: String(req.body.email || ''),
      whatsapp: String(req.body.whatsapp || '')
    });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

app.get('/api/attempts/:id', async (req, res, next) => {
  try { res.json(await payments.getAttemptStatus(req.params.id)); }
  catch (error) { next(error); }
});

app.post('/api/attempts/:id/expire', async (req, res, next) => {
  try { res.json(await payments.expireAttempt(req.params.id)); }
  catch (error) { next(error); }
});

app.post('/api/party/lookup', async (req, res, next) => {
  try { res.json(party.lookupInvite({ code: String(req.body.code || ''), invite: String(req.body.invite || '') })); }
  catch (error) { next(error); }
});

app.post('/api/party/join', async (req, res, next) => {
  try {
    const identity = ensureDeviceIdentity(req, res, String(req.body.resumeToken || ''));
    const deviceId = await network.resolveDeviceId({ claimedDeviceId: String(req.body.deviceId || ''), clientIp: req.ip || req.socket?.remoteAddress || '' });
    const result = await party.joinCombo({ code: String(req.body.code || ''), invite: String(req.body.invite || ''), identityId: identity.identityId, deviceId });
    res.json({ ...result, resumeToken: identity.resumeToken });
  } catch (error) { next(error); }
});

// Somente para testar a interface sem dinheiro real.
app.post('/api/dev/attempts/:id/approve', async (req, res, next) => {
  if ((process.env.PAYMENTS_MODE || 'mock').toLowerCase() !== 'mock') return res.sendStatus(404);
  try { res.json(await payments.approveAttempt(req.params.id, 'mock-button')); }
  catch (error) { next(error); }
});

app.post('/webhooks/mercadopago', async (req, res) => {
  const orderId = String(req.query['data.id'] || req.body?.data?.id || '');
  const secret = process.env.MP_WEBHOOK_SECRET?.trim();

  if (!orderId) return res.status(400).send('missing data.id');
  if (!secret) {
    console.error('[webhook] MP_WEBHOOK_SECRET não configurado.');
    return res.status(503).send('webhook secret not configured');
  }

  try {
    WebhookSignatureValidator.validate({
      xSignature: req.headers['x-signature'],
      xRequestId: req.headers['x-request-id'],
      dataId: String(req.query['data.id'] || orderId),
      secret
    });
  } catch (error) {
    console.warn('[webhook] assinatura inválida:', error.message);
    return res.sendStatus(401);
  }

  // O Mercado Pago espera 200/201 rapidamente. Processamos após confirmar o recebimento.
  res.sendStatus(200);
  setImmediate(async () => {
    try {
      const result = await payments.refreshFromOrder(orderId);
      if (result?.status === 'approved') {
        console.log(`[webhook] Pagamento aprovado: ${orderId} -> acesso até ${new Date(result.accessUntil).toISOString()}`);
      }
    } catch (error) {
      console.error('[webhook] erro ao processar order:', error.message);
    }
  });
});

app.get('/api/mikrotik/test', async (_req, res, next) => {
  try { res.json(await network.testConnection()); }
  catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error('[api]', error.message, error.payload || '');
  const status = error.httpStatus || (error.status >= 400 && error.status < 600 ? 502 : 500);
  res.status(status).json({
    error: error.message || 'Erro interno',
    blockedUntil: error.blockedUntil || undefined,
    attempt: error.attempt || undefined,
    provider: error.payload ? { message: error.payload.message, error: error.payload.error, status: error.payload.status } : undefined
  });
});

setInterval(() => { payments.sweepExpired(); party.sweepExpired(); }, 5_000).unref();
setInterval(() => network.reconcile(), Number(process.env.MIKROTIK_RECONCILE_MS || 30_000)).unref();

app.listen(port, () => {
  const paymentMode = (process.env.PAYMENTS_MODE || 'mock').toLowerCase();
  console.log(`Open Wi-Fi v0.9.0: http://localhost:${port}`);
  console.log(`Painel admin: http://localhost:${port}/admin`);
  const site = party.publicConfig();
  console.log(`Modo: ${site.mode === 'party' ? `PARTY • ${site.event?.name || 'evento'}` : 'Padrão'}`);
  console.log(`Pagamentos: ${paymentMode}`);
  if (paymentMode === 'mercadopago') {
    console.log(`Access Token: ${process.env.MP_ACCESS_TOKEN?.trim() ? 'configurado ✓' : 'NÃO CONFIGURADO ✗'}`);
  }
  const mtMode = (process.env.MIKROTIK_MODE || 'mock').toLowerCase();
  console.log(`MikroTik: ${mtMode}`);
  if (mtMode === 'real') {
    console.log(`RouterOS API: ${process.env.MIKROTIK_HOST || '192.168.88.1'}:${process.env.MIKROTIK_PORT || (String(process.env.MIKROTIK_USE_TLS).toLowerCase() === 'true' ? '8729' : '8728')}`);
    network.testConnection()
      .then(info => console.log(`MikroTik conectada ✓ ${info.router?.['board-name'] || ''} RouterOS ${info.router?.version || ''}`.trim()))
      .catch(error => console.error(`MikroTik NÃO conectou ✗ ${error.message}`));
    setTimeout(() => network.reconcile(), 500).unref();
  }

  if (firebaseSync.isEnabled()) {
    firebaseSync.start()
      .then(info => console.log(`Firebase: ativado ✓ site=${info.siteId} sync=${info.syncMs}ms`))
      .catch(error => console.error(`Firebase NÃO conectou ✗ ${error.message}`));
  } else {
    console.log('Firebase: desativado');
  }
});
