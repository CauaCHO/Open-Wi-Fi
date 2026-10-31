import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebhookSignatureValidator } from 'mercadopago';
import { loadDotEnv } from './src/env.mjs';
import { JsonStore } from './src/store.mjs';
import { PaymentService } from './src/payments.mjs';
import { MikroTikAccessService } from './src/mikrotik.mjs';

loadDotEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8080);
const store = new JsonStore(path.join(__dirname, 'data/store.json'));
const network = new MikroTikAccessService(store);
const payments = new PaymentService(store, network);

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: '0.6.0', paymentsMode: process.env.PAYMENTS_MODE || 'mock', mikrotikMode: process.env.MIKROTIK_MODE || 'mock' });
});

app.get('/api/plans', (_req, res) => res.json(payments.getPlans()));

app.post('/api/attempts', async (req, res, next) => {
  try {
    const deviceId = await network.resolveDeviceId({
      claimedDeviceId: String(req.body.deviceId || ''),
      clientIp: req.ip || req.socket?.remoteAddress || ''
    });
    const result = await payments.createAttempt({
      deviceId,
      plan: String(req.body.plan || ''),
      email: String(req.body.email || '')
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

setInterval(() => payments.sweepExpired(), 5_000).unref();
setInterval(() => network.reconcile(), Number(process.env.MIKROTIK_RECONCILE_MS || 30_000)).unref();

app.listen(port, () => {
  const paymentMode = (process.env.PAYMENTS_MODE || 'mock').toLowerCase();
  console.log(`Open Wi-Fi v0.6.0: http://localhost:${port}`);
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
});
