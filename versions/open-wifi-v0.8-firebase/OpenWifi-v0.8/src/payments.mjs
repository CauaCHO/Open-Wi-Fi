import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { createPixOrder, getOrder, pixDataFromOrder, isAccredited } from './mercadopago.mjs';

export const PLANS = {
  '1h':  { label: '1 hora',    amount: 2,  durationMs: 60 * 60 * 1000 },
  '1d':  { label: '1 dia',     amount: 5,  durationMs: 24 * 60 * 60 * 1000 },
  '7d':  { label: '1 semana',  amount: 10, durationMs: 7 * 24 * 60 * 60 * 1000 },
  '30d': { label: '30 dias',   amount: 25, durationMs: 30 * 24 * 60 * 60 * 1000 }
};

// São funções (e não constantes) porque o .env é carregado pelo servidor depois
// dos imports ESM. Assim os valores do .env são respeitados em tempo de execução.
function attemptWindowMs() { return Number(process.env.ATTEMPT_WINDOW_MS || 30_000); }
function cooldownMs() { return Number(process.env.COOLDOWN_MS || 10 * 60_000); }
function maxAttempts() { return Number(process.env.MAX_ATTEMPTS || 3); }
// O Mercado Pago é criado com expiration_time PT30M. Mantemos o mesmo prazo local
// para saber por quanto tempo uma cobrança pode ser reaproveitada pelo portal.
function pixValidityMs() { return Number(process.env.PIX_VALIDITY_MS || 30 * 60_000); }

function now() { return Date.now(); }
function mode() { return (process.env.PAYMENTS_MODE || 'mock').toLowerCase(); }

function normalizeDevice(device) {
  const t = now();
  if (device.blockedUntil && device.blockedUntil <= t) {
    device.blockedUntil = 0;
    device.attemptsUsed = 0;
  }
  device.attemptsUsed ||= 0;
  device.blockedUntil ||= 0;
  return device;
}

function paymentExpiresAt(attempt) {
  return attempt.paymentExpiresAt || ((attempt.createdAt || now()) + pixValidityMs());
}

function isReusablePayment(attempt, deviceId, plan, t = now()) {
  return attempt.deviceId === deviceId
    && attempt.plan === plan
    && attempt.status === 'waiting'
    && paymentExpiresAt(attempt) > t
    && (attempt.orderId || mode() === 'mock');
}

function publicAttempt(attempt, device) {
  const t = now();
  const expiresAt = paymentExpiresAt(attempt);
  const windowExpired = Boolean(attempt.windowExpired || (attempt.status === 'waiting' && attempt.uiExpiresAt <= t));
  return {
    id: attempt.id,
    plan: attempt.plan,
    planLabel: PLANS[attempt.plan].label,
    amount: PLANS[attempt.plan].amount,
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    maxAttempts: maxAttempts(),
    uiExpiresAt: attempt.uiExpiresAt,
    windowExpired,
    windowActive: attempt.status === 'waiting' && !windowExpired && attempt.uiExpiresAt > t,
    paymentExpiresAt: expiresAt,
    blockedUntil: device?.blockedUntil || 0,
    qrCode: attempt.qrCode || null,
    qrCodeBase64: attempt.qrCodeBase64 || null,
    ticketUrl: attempt.ticketUrl || null,
    accessUntil: attempt.accessUntil || null,
    paymentsMode: mode(),
    paymentsEnvironment: (process.env.MP_ENV || 'production').toLowerCase(),
    sandboxTestAmount: ((process.env.MP_ENV || 'production').toLowerCase() === 'sandbox') ? 50 : null,
    reusedPaymentCount: attempt.reusedPaymentCount || 0,
    networkAccess: attempt.networkAccess || ((process.env.MIKROTIK_MODE || 'mock').toLowerCase() === 'real' ? 'pending' : 'mock'),
    networkError: attempt.networkError || null
  };
}

export class PaymentService {
  constructor(store, network = null) {
    this.store = store;
    this.network = network;
  }

  getPlans() {
    return Object.fromEntries(Object.entries(PLANS).map(([id, p]) => [id, { label: p.label, amount: p.amount }]));
  }

  async createAttempt({ deviceId, plan, email }) {
    if (!PLANS[plan]) throw Object.assign(new Error('Plano inválido'), { httpStatus: 400 });
    if (!deviceId || deviceId.length > 120) throw Object.assign(new Error('Dispositivo inválido'), { httpStatus: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email || '')) throw Object.assign(new Error('Informe um e-mail válido'), { httpStatus: 400 });

    const prepared = await this.store.mutate(async data => {
      const device = normalizeDevice(data.devices[deviceId] ||= { attemptsUsed: 0, blockedUntil: 0 });
      const t = now();

      // Uma cobrança PIX não morre junto com a janela de 30 s. Para o mesmo
      // dispositivo + plano, reaproveitamos a Order/QR enquanto ela estiver válida.
      const reusable = Object.values(data.attempts)
        .filter(a => isReusablePayment(a, deviceId, plan, t))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

      if (reusable) {
        reusable.paymentExpiresAt ||= paymentExpiresAt(reusable);

        // Se a janela de 30 s ainda estiver aberta, apenas devolve o mesmo PIX.
        if (!reusable.windowExpired && reusable.uiExpiresAt > t) {
          return { kind: 'reuse', id: reusable.id, deviceId };
        }

        // Durante o cooldown o usuário ainda pode VER e PAGAR o QR existente,
        // mas não ganha uma nova janela de internet temporária.
        if (device.blockedUntil > t) {
          const error = Object.assign(new Error('Aguarde o cooldown para abrir outra janela de 30 segundos'), { httpStatus: 429 });
          error.blockedUntil = device.blockedUntil;
          error.attempt = publicAttempt(reusable, device);
          throw error;
        }

        if (device.attemptsUsed >= maxAttempts()) {
          device.blockedUntil = t + cooldownMs();
          const error = Object.assign(new Error('Limite de tentativas atingido'), { httpStatus: 429 });
          error.blockedUntil = device.blockedUntil;
          error.attempt = publicAttempt(reusable, device);
          throw error;
        }

        // Nova tentativa = nova janela temporária, mas o QR/Order permanece o mesmo.
        reusable.attemptNumber = ++device.attemptsUsed;
        reusable.windowExpired = false;
        reusable.windowStartedAt = t;
        reusable.uiExpiresAt = t + attemptWindowMs();
        reusable.reusedPaymentCount = (reusable.reusedPaymentCount || 0) + 1;
        return { kind: 'reuse', id: reusable.id, deviceId };
      }

      // Cooldown impede apenas NOVAS cobranças/janelas. Cobranças já existentes
      // foram tratadas acima e continuam pagáveis.
      if (device.blockedUntil > t) {
        const error = Object.assign(new Error('Dispositivo temporariamente bloqueado'), { httpStatus: 429 });
        error.blockedUntil = device.blockedUntil;
        throw error;
      }

      if (device.attemptsUsed >= maxAttempts()) {
        device.blockedUntil = t + cooldownMs();
        const error = Object.assign(new Error('Limite de tentativas atingido'), { httpStatus: 429 });
        error.blockedUntil = device.blockedUntil;
        throw error;
      }

      const id = crypto.randomUUID();
      const attemptNumber = ++device.attemptsUsed;
      const attempt = {
        id,
        deviceId,
        plan,
        email,
        attemptNumber,
        status: 'creating',
        createdAt: t,
        windowStartedAt: t,
        uiExpiresAt: t + attemptWindowMs(),
        windowExpired: false,
        paymentExpiresAt: t + pixValidityMs(),
        orderId: null,
        paymentId: null,
        qrCode: null,
        qrCodeBase64: null,
        ticketUrl: null,
        accessUntil: null,
        reusedPaymentCount: 0
      };
      data.attempts[id] = attempt;
      return { kind: 'new', id, attemptNumber, deviceId };
    });

    if (prepared.kind === 'reuse') {
      const status = this.getAttemptStatusNoExpire(prepared.id);
      await this.#tryGrantTemporary(prepared.id, status);
      return this.getAttemptStatusNoExpire(prepared.id);
    }

    try {
      const result = mode() === 'mercadopago'
        ? await this.#createMercadoPagoOrder(prepared.id, plan, email)
        : this.#createMockOrder(prepared.id, plan);

      const created = await this.store.mutate(async data => {
        const attempt = data.attempts[prepared.id];
        Object.assign(attempt, result, { status: 'waiting' });
        const device = normalizeDevice(data.devices[deviceId]);
        return publicAttempt(attempt, device);
      });
      await this.#tryGrantTemporary(prepared.id, created);
      return this.getAttemptStatusNoExpire(prepared.id);
    } catch (error) {
      await this.store.mutate(async data => {
        const attempt = data.attempts[prepared.id];
        if (attempt) attempt.status = 'create_failed';
        const device = normalizeDevice(data.devices[deviceId]);
        // Falha técnica ao criar a cobrança não deve consumir tentativa do usuário.
        device.attemptsUsed = Math.max(0, (device.attemptsUsed || 1) - 1);
      });
      throw error;
    }
  }

  async #createMercadoPagoOrder(attemptId, plan, email) {
    const p = PLANS[plan];
    const externalReference = `OWF${attemptId.replaceAll('-', '')}`;
    let order = await createPixOrder({ amount: p.amount, email, externalReference });

    if (!order.id) {
      const error = new Error('Mercado Pago não retornou o ID da order');
      error.payload = order;
      throw error;
    }

    // A criação da Order pode ser assíncrona. Em alguns casos o POST inicial
    // ainda não contém qr_code/ticket_url. Consultamos a Order por alguns segundos.
    let pix = pixDataFromOrder(order);
    for (let i = 0; i < 8 && !pix.qrCode && !pix.qrCodeBase64 && !pix.ticketUrl; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      order = await getOrder(order.id);
      pix = pixDataFromOrder(order);
    }

    pix = await this.#ensureQrImage(pix);
    return { orderId: order.id, ...pix };
  }

  async #ensureQrImage(pix) {
    if (pix.qrCodeBase64 || !pix.qrCode) return pix;
    try {
      const dataUrl = await QRCode.toDataURL(pix.qrCode, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 512
      });
      return { ...pix, qrCodeBase64: dataUrl.replace(/^data:image\/png;base64,/, '') };
    } catch (error) {
      console.error('[qr] Falha ao renderizar qr_code localmente:', error.message);
      return pix;
    }
  }

  #createMockOrder(attemptId, plan) {
    const amount = PLANS[plan].amount.toFixed(2).replace('.', ',');
    return {
      orderId: `MOCK-${attemptId}`,
      paymentId: `MOCKPAY-${attemptId}`,
      qrCode: `OPENWIFI-MOCK-${attemptId}`,
      qrCodeBase64: null,
      ticketUrl: null,
      mockText: `PIX TESTE R$ ${amount}`
    };
  }

  async getAttemptStatus(id) {
    let snapshot = this.store.read(data => {
      const attempt = data.attempts[id];
      if (!attempt) return null;
      const device = normalizeDevice(data.devices[attempt.deviceId]);
      return { attempt: structuredClone(attempt), device: structuredClone(device) };
    });
    if (!snapshot) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });

    if (snapshot.attempt.status === 'waiting' && mode() === 'mercadopago' && String(process.env.MP_STATUS_POLLING).toLowerCase() === 'true') {
      const t = now();
      const lastCheck = snapshot.attempt.lastProviderCheckAt || 0;
      if (snapshot.attempt.orderId && t - lastCheck >= 3000) {
        await this.store.mutate(async data => {
          if (data.attempts[id]) data.attempts[id].lastProviderCheckAt = t;
        });
        try {
          const order = await getOrder(snapshot.attempt.orderId);
          console.log(`[polling] ${snapshot.attempt.orderId}: ${order?.status || '?'} / ${order?.status_detail || '?'}`);
          if (isAccredited(order)) return this.approveAttempt(id, 'mercadopago-polling');

          const pix = await this.#ensureQrImage(pixDataFromOrder(order));
          if (pix.qrCode || pix.qrCodeBase64 || pix.ticketUrl) {
            await this.store.mutate(async data => {
              const current = data.attempts[id];
              if (!current || current.status !== 'waiting') return;
              if (pix.paymentId) current.paymentId = pix.paymentId;
              if (pix.qrCode) current.qrCode = pix.qrCode;
              if (pix.qrCodeBase64) current.qrCodeBase64 = pix.qrCodeBase64;
              if (pix.ticketUrl) current.ticketUrl = pix.ticketUrl;
            });
          }
        } catch (error) {
          console.error('[polling] Falha ao consultar order:', error.message);
        }
      }
    }

    // A janela de internet temporária termina, mas a cobrança permanece waiting.
    snapshot = this.store.read(data => {
      const attempt = data.attempts[id];
      if (!attempt) return null;
      return { attempt: structuredClone(attempt), device: structuredClone(normalizeDevice(data.devices[attempt.deviceId])) };
    });

    if (snapshot.attempt.status === 'waiting' && !snapshot.attempt.windowExpired && now() >= snapshot.attempt.uiExpiresAt) {
      return this.expireAttempt(id);
    }

    if (snapshot.attempt.status === 'waiting' && now() >= paymentExpiresAt(snapshot.attempt)) {
      return this.expirePayment(id);
    }

    return this.getAttemptStatusNoExpire(id);
  }

  // Mantemos o nome da rota/método por compatibilidade com o front antigo.
  // Agora "expireAttempt" fecha SOMENTE a janela temporária de 30 s.
  async expireAttempt(id) {
    const snapshot = this.store.read(data => data.attempts[id] ? structuredClone(data.attempts[id]) : null);
    if (!snapshot) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
    if (snapshot.status !== 'waiting' && snapshot.status !== 'creating') {
      return this.getAttemptStatusNoExpire(id);
    }
    if (now() < snapshot.uiExpiresAt) {
      return this.getAttemptStatusNoExpire(id);
    }

    // Checa uma última vez se o PIX caiu exatamente no limite dos 30 s.
    if (mode() === 'mercadopago' && snapshot.orderId) {
      try {
        const order = await getOrder(snapshot.orderId);
        if (isAccredited(order)) return this.approveAttempt(id, 'mercadopago-window-race');
      } catch (error) {
        console.error('[window] Falha ao consultar order:', error.message);
      }
    }

    const closed = await this.store.mutate(async data => {
      const attempt = data.attempts[id];
      if (!attempt) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
      if (attempt.status === 'approved') return publicAttempt(attempt, data.devices[attempt.deviceId]);

      // NÃO cancela a Order. O QR continua válido e o polling/webhook continuam ativos.
      attempt.windowExpired = true;
      attempt.windowClosedAt = now();

      const device = normalizeDevice(data.devices[attempt.deviceId]);
      if (device.attemptsUsed >= maxAttempts() && !device.blockedUntil) {
        device.blockedUntil = now() + cooldownMs();
      }
      return publicAttempt(attempt, device);
    });
    if (closed.status !== 'approved') await this.#tryEndTemporary(id);
    return this.getAttemptStatusNoExpire(id);
  }

  async expirePayment(id) {
    const expired = await this.store.mutate(async data => {
      const attempt = data.attempts[id];
      if (!attempt) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
      if (attempt.status !== 'waiting') return publicAttempt(attempt, data.devices[attempt.deviceId]);
      attempt.status = 'payment_expired';
      attempt.paymentExpiredAt = now();
      attempt.windowExpired = true;
      const device = normalizeDevice(data.devices[attempt.deviceId]);
      return publicAttempt(attempt, device);
    });
    await this.#tryEndTemporary(id);
    return this.getAttemptStatusNoExpire(id);
  }

  getAttemptStatusNoExpire(id) {
    return this.store.read(data => {
      const attempt = data.attempts[id];
      if (!attempt) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
      const device = normalizeDevice(data.devices[attempt.deviceId]);
      return publicAttempt(attempt, device);
    });
  }

  async refreshFromOrder(orderId) {
    if (mode() !== 'mercadopago') return null;
    const order = await getOrder(orderId);
    const attemptId = this.store.read(data => {
      const matches = Object.values(data.attempts)
        .filter(a => a.orderId === orderId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return matches[0]?.id || null;
    });
    if (!attemptId) return null;
    if (isAccredited(order)) return this.approveAttempt(attemptId, 'mercadopago-webhook');
    return this.getAttemptStatusNoExpire(attemptId);
  }

  async approveAttempt(id, source = 'manual') {
    const approved = await this.store.mutate(async data => {
      const attempt = data.attempts[id];
      if (!attempt) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
      const device = normalizeDevice(data.devices[attempt.deviceId]);
      if (attempt.status !== 'approved') {
        attempt.status = 'approved';
        attempt.approvedAt = now();
        attempt.approvalSource = source;
        attempt.accessUntil = now() + PLANS[attempt.plan].durationMs;
      }
      device.attemptsUsed = 0;
      device.blockedUntil = 0;
      // Um pagamento posterior de plano menor nunca deve reduzir um acesso já maior.
      device.accessUntil = Math.max(device.accessUntil || 0, attempt.accessUntil || 0);
      device.lastApprovedAttempt = attempt.id;
      device.lastApprovedPlan = attempt.plan;
      attempt.networkAccess = ((process.env.MIKROTIK_MODE || 'mock').toLowerCase() === 'real') ? 'syncing' : 'mock';
      attempt.networkError = null;
      return {
        public: publicAttempt(attempt, device),
        deviceId: attempt.deviceId,
        accessUntil: device.accessUntil,
        plan: attempt.plan
      };
    });

    if (this.network?.isReal?.()) {
      try {
        await this.network.grantPaid(approved.deviceId, approved.accessUntil, id, approved.plan);
        await this.store.mutate(async data => {
          const attempt = data.attempts[id];
          if (attempt) {
            attempt.networkAccess = 'active';
            attempt.networkError = null;
            attempt.networkSyncedAt = now();
          }
        });
      } catch (error) {
        console.error('[mikrotik/approve]', error.message);
        await this.store.mutate(async data => {
          const attempt = data.attempts[id];
          if (attempt) {
            attempt.networkAccess = 'sync_error';
            attempt.networkError = error.message;
          }
        });
      }
    }
    return this.getAttemptStatusNoExpire(id);
  }

  async #tryGrantTemporary(id, status) {
    if (!this.network?.isReal?.() || !status?.windowActive) return;
    const attempt = this.store.read(data => data.attempts[id] ? structuredClone(data.attempts[id]) : null);
    if (!attempt) return;
    try {
      await this.network.grantTemporary(attempt.deviceId, attempt.uiExpiresAt, attempt.id);
      await this.store.mutate(async data => {
        const current = data.attempts[id];
        if (current && current.status === 'waiting') {
          current.networkAccess = 'temporary';
          current.networkError = null;
        }
      });
    } catch (error) {
      console.error('[mikrotik/temp]', error.message);
      await this.store.mutate(async data => {
        const current = data.attempts[id];
        if (current) {
          current.networkAccess = 'sync_error';
          current.networkError = error.message;
        }
      });
    }
  }

  async #tryEndTemporary(id) {
    if (!this.network?.isReal?.()) return;
    const attempt = this.store.read(data => data.attempts[id] ? structuredClone(data.attempts[id]) : null);
    if (!attempt) return;
    try {
      await this.network.endTemporary(attempt.deviceId);
      await this.store.mutate(async data => {
        const current = data.attempts[id];
        if (current && current.status === 'waiting') {
          current.networkAccess = 'portal-only';
          current.networkError = null;
        }
      });
    } catch (error) {
      console.error('[mikrotik/temp-end]', error.message);
      await this.store.mutate(async data => {
        const current = data.attempts[id];
        if (current) {
          current.networkAccess = 'sync_error';
          current.networkError = error.message;
        }
      });
    }
  }

  async sweepExpired() {
    const t = now();
    const { windows, payments } = this.store.read(data => ({
      windows: Object.values(data.attempts)
        .filter(a => a.status === 'waiting' && !a.windowExpired && a.uiExpiresAt <= t)
        .map(a => a.id),
      payments: Object.values(data.attempts)
        .filter(a => a.status === 'waiting' && paymentExpiresAt(a) <= t)
        .map(a => a.id)
    }));

    for (const id of windows) {
      try { await this.expireAttempt(id); } catch (error) { console.error('[sweeper/window]', error.message); }
    }
    for (const id of payments) {
      try {
        // Se polling estiver ligado, dá uma última chance de reconhecer o pagamento.
        const status = await this.getAttemptStatus(id);
        if (status.status === 'waiting') await this.expirePayment(id);
      } catch (error) { console.error('[sweeper/pix]', error.message); }
    }
  }
}
