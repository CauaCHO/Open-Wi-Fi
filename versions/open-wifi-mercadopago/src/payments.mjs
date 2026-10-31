import crypto from 'node:crypto';
import { createPixOrder, getOrder, cancelOrder, pixDataFromOrder, isAccredited, isCancelable } from './mercadopago.mjs';

export const PLANS = {
  '1h':  { label: '1 hora',    amount: 2,  durationMs: 60 * 60 * 1000 },
  '1d':  { label: '1 dia',     amount: 5,  durationMs: 24 * 60 * 60 * 1000 },
  '7d':  { label: '1 semana',  amount: 10, durationMs: 7 * 24 * 60 * 60 * 1000 },
  '30d': { label: '30 dias',   amount: 25, durationMs: 30 * 24 * 60 * 60 * 1000 }
};

const ATTEMPT_WINDOW_MS = 30_000;
const COOLDOWN_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

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

function publicAttempt(attempt, device) {
  return {
    id: attempt.id,
    plan: attempt.plan,
    planLabel: PLANS[attempt.plan].label,
    amount: PLANS[attempt.plan].amount,
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    maxAttempts: MAX_ATTEMPTS,
    uiExpiresAt: attempt.uiExpiresAt,
    blockedUntil: device?.blockedUntil || 0,
    qrCode: attempt.qrCode || null,
    qrCodeBase64: attempt.qrCodeBase64 || null,
    ticketUrl: attempt.ticketUrl || null,
    accessUntil: attempt.accessUntil || null,
    paymentsMode: mode()
  };
}

export class PaymentService {
  constructor(store) {
    this.store = store;
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
      if (device.blockedUntil > t) {
        const error = Object.assign(new Error('Dispositivo temporariamente bloqueado'), { httpStatus: 429 });
        error.blockedUntil = device.blockedUntil;
        throw error;
      }

      const active = Object.values(data.attempts).find(a => a.deviceId === deviceId && a.status === 'waiting' && a.uiExpiresAt > t);
      if (active) {
        const error = Object.assign(new Error('Já existe um PIX ativo para este dispositivo'), { httpStatus: 409 });
        error.attempt = publicAttempt(active, device);
        throw error;
      }

      if (device.attemptsUsed >= MAX_ATTEMPTS) {
        device.blockedUntil = t + COOLDOWN_MS;
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
        uiExpiresAt: t + ATTEMPT_WINDOW_MS,
        orderId: null,
        paymentId: null,
        qrCode: null,
        qrCodeBase64: null,
        ticketUrl: null,
        accessUntil: null
      };
      data.attempts[id] = attempt;
      return { id, attemptNumber };
    });

    try {
      const result = mode() === 'mercadopago'
        ? await this.#createMercadoPagoOrder(prepared.id, plan, email)
        : this.#createMockOrder(prepared.id, plan);

      return this.store.mutate(async data => {
        const attempt = data.attempts[prepared.id];
        Object.assign(attempt, result, { status: 'waiting' });
        const device = normalizeDevice(data.devices[deviceId]);
        return publicAttempt(attempt, device);
      });
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
    const order = await createPixOrder({ amount: p.amount, email, externalReference });
    const pix = pixDataFromOrder(order);
    if (!order.id || (!pix.qrCode && !pix.qrCodeBase64)) {
      const error = new Error('Mercado Pago criou a order, mas não retornou o QR PIX esperado');
      error.payload = order;
      throw error;
    }
    return { orderId: order.id, ...pix };
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
    const snapshot = this.store.read(data => {
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
          if (isAccredited(order)) return this.approveAttempt(id, 'mercadopago-polling');
        } catch (error) {
          console.error('[polling] Falha ao consultar order:', error.message);
        }
      }
    }

    if (snapshot.attempt.status === 'waiting' && now() >= snapshot.attempt.uiExpiresAt) {
      return this.expireAttempt(id);
    }
    return this.getAttemptStatusNoExpire(id);
  }

  async expireAttempt(id) {
    const snapshot = this.store.read(data => data.attempts[id] ? structuredClone(data.attempts[id]) : null);
    if (!snapshot) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
    if (snapshot.status !== 'waiting' && snapshot.status !== 'creating') {
      return this.getAttemptStatusNoExpire(id);
    }
    if (now() < snapshot.uiExpiresAt) {
      return this.getAttemptStatusNoExpire(id);
    }

    let paid = false;
    if (mode() === 'mercadopago' && snapshot.orderId) {
      try {
        const order = await getOrder(snapshot.orderId);
        paid = isAccredited(order);
        if (!paid && isCancelable(order)) {
          try {
            await cancelOrder(snapshot.orderId);
          } catch (cancelError) {
            // Pode haver corrida: o PIX foi pago entre o GET e o cancelamento.
            if (cancelError.status === 409) {
              const refreshed = await getOrder(snapshot.orderId);
              paid = isAccredited(refreshed);
            } else {
              throw cancelError;
            }
          }
        }
      } catch (error) {
        console.error('[expire] Falha ao consultar/cancelar order:', error.message);
      }
    }

    if (paid) return this.approveAttempt(id, 'mercadopago-expiry-race');

    return this.store.mutate(async data => {
      const attempt = data.attempts[id];
      if (!attempt) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
      if (attempt.status === 'approved') return publicAttempt(attempt, data.devices[attempt.deviceId]);
      attempt.status = 'expired';
      attempt.expiredAt = now();
      const device = normalizeDevice(data.devices[attempt.deviceId]);
      if (device.attemptsUsed >= MAX_ATTEMPTS) {
        device.blockedUntil = now() + COOLDOWN_MS;
      }
      return publicAttempt(attempt, device);
    });
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
      const match = Object.values(data.attempts).find(a => a.orderId === orderId);
      return match?.id || null;
    });
    if (!attemptId) return null;
    if (isAccredited(order)) return this.approveAttempt(attemptId, 'mercadopago-webhook');
    return this.getAttemptStatusNoExpire(attemptId);
  }

  async approveAttempt(id, source = 'manual') {
    return this.store.mutate(async data => {
      const attempt = data.attempts[id];
      if (!attempt) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
      if (attempt.status !== 'approved') {
        attempt.status = 'approved';
        attempt.approvedAt = now();
        attempt.approvalSource = source;
        attempt.accessUntil = now() + PLANS[attempt.plan].durationMs;
      }
      const device = normalizeDevice(data.devices[attempt.deviceId]);
      device.attemptsUsed = 0;
      device.blockedUntil = 0;
      device.accessUntil = attempt.accessUntil;
      device.lastApprovedAttempt = attempt.id;
      return publicAttempt(attempt, device);
    });
  }

  async sweepExpired() {
    const ids = this.store.read(data => Object.values(data.attempts)
      .filter(a => a.status === 'waiting' && a.uiExpiresAt <= now())
      .map(a => a.id));
    for (const id of ids) {
      try { await this.expireAttempt(id); } catch (error) { console.error('[sweeper]', error.message); }
    }
  }
}
