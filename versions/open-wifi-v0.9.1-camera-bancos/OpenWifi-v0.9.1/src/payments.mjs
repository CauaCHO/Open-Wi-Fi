import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { createPixOrder, getOrder, pixDataFromOrder, isAccredited } from './mercadopago.mjs';
import { planFromAttempt } from './plans.mjs';

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

function normalizeIdentity(identity) {
  identity ||= {};
  const t = now();
  if (identity.blockedUntil && identity.blockedUntil <= t) {
    identity.blockedUntil = 0;
    identity.attemptsUsed = 0;
  }
  identity.attemptsUsed ||= 0;
  identity.blockedUntil ||= 0;
  identity.accessUntil ||= 0;
  identity.deviceIds = Array.isArray(identity.deviceIds) ? [...new Set(identity.deviceIds.filter(Boolean))] : [];
  return identity;
}

function attemptIdentityId(attempt) {
  return attempt.identityId || attempt.deviceId;
}


function dataIdentity(data, identityId) {
  data.identities ||= {};
  return normalizeIdentity(data.identities[identityId] ||= {});
}

function linkIdentity(identity, deviceId, email = '') {
  if (deviceId && !identity.deviceIds.includes(deviceId)) identity.deviceIds.push(deviceId);
  identity.lastSeenAt = now();
  if (!identity.createdAt) identity.createdAt = identity.lastSeenAt;
  if (email) identity.email = email;
  return identity;
}

function paymentExpiresAt(attempt) {
  return attempt.paymentExpiresAt || ((attempt.createdAt || now()) + pixValidityMs());
}

function isReusablePayment(attempt, identityId, plan, eventId = null, t = now()) {
  return attemptIdentityId(attempt) === identityId
    && attempt.plan === plan
    && (!eventId || attempt.eventId === eventId)
    && attempt.status === 'waiting'
    && paymentExpiresAt(attempt) > t
    && (attempt.orderId || mode() === 'mock');
}

function publicAttempt(attempt, identity) {
  const t = now();
  const expiresAt = paymentExpiresAt(attempt);
  const windowExpired = Boolean(attempt.windowExpired || (attempt.status === 'waiting' && attempt.uiExpiresAt <= t));
  return {
    id: attempt.id,
    plan: attempt.plan,
    planLabel: attempt.planLabel || planFromAttempt(attempt)?.label || attempt.plan,
    amount: Number(attempt.amount ?? planFromAttempt(attempt)?.amount ?? 0),
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    maxAttempts: maxAttempts(),
    uiExpiresAt: attempt.uiExpiresAt,
    windowExpired,
    windowActive: attempt.status === 'waiting' && !windowExpired && attempt.uiExpiresAt > t,
    paymentExpiresAt: expiresAt,
    blockedUntil: identity?.blockedUntil || 0,
    identityId: attemptIdentityId(attempt),
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
  constructor(store, network = null, party = null) {
    this.store = store;
    this.network = network;
    this.party = party;
  }

  getPlans() {
    return this.party?.publicConfig?.() || { mode: 'standard', event: null, plans: {} };
  }

  async registerIdentity({ identityId, deviceId, email = '' }) {
    if (!identityId || identityId.length > 120) throw Object.assign(new Error('Identidade do dispositivo inválida'), { httpStatus: 400 });
    if (!deviceId || deviceId.length > 120) throw Object.assign(new Error('Dispositivo inválido'), { httpStatus: 400 });

    const state = await this.store.mutate(async data => {
      data.identities ||= {};
      const identity = linkIdentity(normalizeIdentity(data.identities[identityId] ||= {}), deviceId, email);
      const networkDevice = normalizeDevice(data.devices[deviceId] ||= {});

      // Migração suave da v0.8.1: se este MAC já tinha um acesso pago,
      // a nova identidade lógica herda esse acesso.
      if (Number(networkDevice.accessUntil || 0) > Number(identity.accessUntil || 0)) {
        identity.accessUntil = Number(networkDevice.accessUntil || 0);
        identity.lastApprovedAttempt = networkDevice.lastApprovedAttempt || identity.lastApprovedAttempt || '';
        identity.lastApprovedPlan = networkDevice.lastApprovedPlan || identity.lastApprovedPlan || '';
      }

      if (identity.accessUntil > now()) {
        networkDevice.accessUntil = Math.max(Number(networkDevice.accessUntil || 0), Number(identity.accessUntil));
        networkDevice.lastApprovedAttempt = identity.lastApprovedAttempt || networkDevice.lastApprovedAttempt || '';
        networkDevice.lastApprovedPlan = identity.lastApprovedPlan || networkDevice.lastApprovedPlan || '';
      }

      return {
        identityId,
        deviceId,
        accessActive: Number(identity.accessUntil || 0) > now(),
        accessUntil: Number(identity.accessUntil || 0) || null,
        plan: identity.lastApprovedPlan || null,
        linkedDevices: identity.deviceIds.length
      };
    });

    state.planLabel = this.store.read(data => data.identities?.[identityId]?.lastApprovedPlanLabel || null) || state.plan || null;
    if (state.accessActive && this.network?.isReal?.()) {
      try {
        await this.network.grantPaid(state.deviceId, state.accessUntil, `identity-${identityId}`, state.plan || '-');
        state.networkAccess = 'active';
      } catch (error) {
        state.networkAccess = 'sync_error';
        state.networkError = error.message;
      }
    } else {
      state.networkAccess = this.network?.isReal?.() ? 'portal-only' : 'mock';
    }
    return state;
  }

  async createAttempt({ deviceId, identityId, plan, email, whatsapp = '' }) {
    const selectedPlan = this.party?.getPlan?.(plan);
    if (!selectedPlan) throw Object.assign(new Error('Plano inválido para o modo atual'), { httpStatus: 400 });
    if (selectedPlan.comboSlots && !String(whatsapp || '').trim()) throw Object.assign(new Error('Informe um WhatsApp para receber o convite do combo'), { httpStatus: 400 });
    if (!deviceId || deviceId.length > 120) throw Object.assign(new Error('Dispositivo inválido'), { httpStatus: 400 });
    if (!identityId || identityId.length > 120) throw Object.assign(new Error('Identidade do dispositivo inválida'), { httpStatus: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email || '')) throw Object.assign(new Error('Informe um e-mail válido'), { httpStatus: 400 });

    const prepared = await this.store.mutate(async data => {
      data.identities ||= {};
      const identity = linkIdentity(normalizeIdentity(data.identities[identityId] ||= {}), deviceId, email);
      const networkDevice = normalizeDevice(data.devices[deviceId] ||= {});
      if (Number(networkDevice.accessUntil || 0) > Number(identity.accessUntil || 0)) {
        identity.accessUntil = Number(networkDevice.accessUntil || 0);
        identity.lastApprovedAttempt = networkDevice.lastApprovedAttempt || identity.lastApprovedAttempt || '';
        identity.lastApprovedPlan = networkDevice.lastApprovedPlan || identity.lastApprovedPlan || '';
      }
      const t = now();

      // Uma cobrança PIX não morre junto com a janela de 30 s. Para o mesmo
      // dispositivo + plano, reaproveitamos a Order/QR enquanto ela estiver válida.
      const reusable = Object.values(data.attempts)
        .filter(a => isReusablePayment(a, identityId, plan, selectedPlan.eventId || null, t))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

      if (reusable) {
        reusable.paymentExpiresAt ||= paymentExpiresAt(reusable);

        // Se a janela de 30 s ainda estiver aberta, apenas devolve o mesmo PIX.
        if (!reusable.windowExpired && reusable.uiExpiresAt > t) {
          reusable.deviceId = deviceId;
          reusable.identityId = identityId;
          reusable.macHistory = [...new Set([...(reusable.macHistory || []), deviceId])];
          return { kind: 'reuse', id: reusable.id, deviceId, identityId };
        }

        // Durante o cooldown o usuário ainda pode VER e PAGAR o QR existente,
        // mas não ganha uma nova janela de internet temporária.
        if (identity.blockedUntil > t) {
          const error = Object.assign(new Error('Aguarde o cooldown para abrir outra janela de 30 segundos'), { httpStatus: 429 });
          error.blockedUntil = identity.blockedUntil;
          error.attempt = publicAttempt(reusable, identity);
          throw error;
        }

        if (identity.attemptsUsed >= maxAttempts()) {
          identity.blockedUntil = t + cooldownMs();
          const error = Object.assign(new Error('Limite de tentativas atingido'), { httpStatus: 429 });
          error.blockedUntil = identity.blockedUntil;
          error.attempt = publicAttempt(reusable, identity);
          throw error;
        }

        // Nova tentativa = nova janela temporária, mas o QR/Order permanece o mesmo.
        reusable.attemptNumber = ++identity.attemptsUsed;
        reusable.deviceId = deviceId;
        reusable.identityId = identityId;
        reusable.macHistory = [...new Set([...(reusable.macHistory || []), deviceId])];
        reusable.windowExpired = false;
        reusable.windowStartedAt = t;
        reusable.uiExpiresAt = t + attemptWindowMs();
        reusable.reusedPaymentCount = (reusable.reusedPaymentCount || 0) + 1;
        return { kind: 'reuse', id: reusable.id, deviceId, identityId };
      }

      // Cooldown impede apenas NOVAS cobranças/janelas. Cobranças já existentes
      // foram tratadas acima e continuam pagáveis.
      if (identity.blockedUntil > t) {
        const error = Object.assign(new Error('Dispositivo temporariamente bloqueado'), { httpStatus: 429 });
        error.blockedUntil = identity.blockedUntil;
        throw error;
      }

      if (identity.attemptsUsed >= maxAttempts()) {
        identity.blockedUntil = t + cooldownMs();
        const error = Object.assign(new Error('Limite de tentativas atingido'), { httpStatus: 429 });
        error.blockedUntil = identity.blockedUntil;
        throw error;
      }

      const id = crypto.randomUUID();
      const attemptNumber = ++identity.attemptsUsed;
      const attempt = {
        id,
        deviceId,
        identityId,
        macHistory: [deviceId],
        plan,
        planLabel: selectedPlan.label,
        amount: selectedPlan.amount,
        planSnapshot: { ...selectedPlan },
        mode: selectedPlan.mode || 'standard',
        eventId: selectedPlan.eventId || null,
        eventEndsAt: selectedPlan.eventEndsAt || null,
        email,
        whatsapp: String(whatsapp || '').trim(),
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
      return { kind: 'new', id, attemptNumber, deviceId, identityId };
    });

    if (prepared.kind === 'reuse') {
      const status = this.getAttemptStatusNoExpire(prepared.id);
      await this.#tryGrantTemporary(prepared.id, status);
      return this.getAttemptStatusNoExpire(prepared.id);
    }

    try {
      const result = mode() === 'mercadopago'
        ? await this.#createMercadoPagoOrder(prepared.id, selectedPlan, email)
        : this.#createMockOrder(prepared.id, selectedPlan);

      const created = await this.store.mutate(async data => {
        const attempt = data.attempts[prepared.id];
        Object.assign(attempt, result, { status: 'waiting' });
        const identity = normalizeIdentity(data.identities[identityId]);
        return publicAttempt(attempt, identity);
      });
      await this.#tryGrantTemporary(prepared.id, created);
      return this.getAttemptStatusNoExpire(prepared.id);
    } catch (error) {
      await this.store.mutate(async data => {
        const attempt = data.attempts[prepared.id];
        if (attempt) attempt.status = 'create_failed';
        const identity = normalizeIdentity(data.identities[identityId]);
        // Falha técnica ao criar a cobrança não deve consumir tentativa do usuário.
        identity.attemptsUsed = Math.max(0, (identity.attemptsUsed || 1) - 1);
      });
      throw error;
    }
  }

  async #createMercadoPagoOrder(attemptId, planDef, email) {
    const p = planDef;
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

  #createMockOrder(attemptId, planDef) {
    const amount = Number(planDef.amount).toFixed(2).replace('.', ',');
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
      const identity = dataIdentity(data, attemptIdentityId(attempt));
      return { attempt: structuredClone(attempt), identity: structuredClone(identity) };
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
      return { attempt: structuredClone(attempt), identity: structuredClone(dataIdentity(data, attemptIdentityId(attempt))) };
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
      if (attempt.status === 'approved') return publicAttempt(attempt, dataIdentity(data, attemptIdentityId(attempt)));

      // NÃO cancela a Order. O QR continua válido e o polling/webhook continuam ativos.
      attempt.windowExpired = true;
      attempt.windowClosedAt = now();

      const identity = dataIdentity(data, attemptIdentityId(attempt));
      if (identity.attemptsUsed >= maxAttempts() && !identity.blockedUntil) {
        identity.blockedUntil = now() + cooldownMs();
      }
      return publicAttempt(attempt, identity);
    });
    if (closed.status !== 'approved') await this.#tryEndTemporary(id);
    return this.getAttemptStatusNoExpire(id);
  }

  async expirePayment(id) {
    const expired = await this.store.mutate(async data => {
      const attempt = data.attempts[id];
      if (!attempt) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
      if (attempt.status !== 'waiting') return publicAttempt(attempt, dataIdentity(data, attemptIdentityId(attempt)));
      attempt.status = 'payment_expired';
      attempt.paymentExpiredAt = now();
      attempt.windowExpired = true;
      const identity = dataIdentity(data, attemptIdentityId(attempt));
      return publicAttempt(attempt, identity);
    });
    await this.#tryEndTemporary(id);
    return this.getAttemptStatusNoExpire(id);
  }

  getAttemptStatusNoExpire(id) {
    return this.store.read(data => {
      const attempt = data.attempts[id];
      if (!attempt) throw Object.assign(new Error('Tentativa não encontrada'), { httpStatus: 404 });
      const identity = dataIdentity(data, attemptIdentityId(attempt));
      const result = publicAttempt(attempt, identity);
      if (attempt.comboId && data.combos?.[attempt.comboId]) {
        const c = data.combos[attempt.comboId];
        result.combo = {
          id: c.id, code: c.code, label: c.label, maxDevices: c.maxDevices, usedDevices: (c.members || []).length,
          availableSlots: Math.max(0, c.maxDevices - (c.members || []).length), expiresAt: c.expiresAt, eventName: c.eventName,
          inviteUrl: c.inviteUrl, inviteQrCodeBase64: c.inviteQrCodeBase64, whatsappMasked: c.whatsapp ? `${String(c.whatsapp).slice(0,4)}••••${String(c.whatsapp).slice(-4)}` : '-',
          whatsappStatus: c.whatsappStatus || null, whatsappShareUrl: c.whatsappShareUrl || ''
        };
      }
      return result;
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
      data.identities ||= {};
      const identityId = attemptIdentityId(attempt);
      const identity = linkIdentity(normalizeIdentity(data.identities[identityId] ||= {}), attempt.deviceId, attempt.email || '');

      if (attempt.status !== 'approved') {
        attempt.status = 'approved';
        attempt.approvedAt = now();
        attempt.approvalSource = source;
        attempt.accessUntil = this.party?.accessUntilForAttempt?.(attempt) || (now() + Number(planFromAttempt(attempt)?.durationMs || 0));
      }

      identity.attemptsUsed = 0;
      identity.blockedUntil = 0;
      identity.accessUntil = Math.max(Number(identity.accessUntil || 0), Number(attempt.accessUntil || 0));
      identity.lastApprovedAttempt = attempt.id;
      identity.lastApprovedPlan = attempt.plan;
      identity.lastApprovedPlanLabel = attempt.planLabel || planFromAttempt(attempt)?.label || attempt.plan;
      identity.email = attempt.email || identity.email || '';

      // Um Device ID lógico pode possuir mais de um MAC (ex.: SSIDs 2.4/5 GHz
      // distintos com MAC privado diferente). Todos os MACs já vinculados recebem
      // a mesma validade paga.
      for (const networkDeviceId of identity.deviceIds) {
        const networkDevice = normalizeDevice(data.devices[networkDeviceId] ||= {});
        networkDevice.accessUntil = Math.max(Number(networkDevice.accessUntil || 0), Number(identity.accessUntil));
        networkDevice.lastApprovedAttempt = attempt.id;
        networkDevice.lastApprovedPlan = attempt.plan;
        networkDevice.identityId = identityId;
      }

      attempt.networkAccess = ((process.env.MIKROTIK_MODE || 'mock').toLowerCase() === 'real') ? 'syncing' : 'mock';
      attempt.networkError = null;
      return {
        public: publicAttempt(attempt, identity),
        identityId,
        deviceIds: [...identity.deviceIds],
        accessUntil: identity.accessUntil,
        plan: attempt.plan
      };
    });

    if (this.network?.isReal?.()) {
      const errors = [];
      for (const deviceId of approved.deviceIds) {
        try {
          await this.network.grantPaid(deviceId, approved.accessUntil, id, approved.plan);
        } catch (error) {
          errors.push(`${deviceId}: ${error.message}`);
        }
      }
      await this.store.mutate(async data => {
        const attempt = data.attempts[id];
        if (!attempt) return;
        if (errors.length) {
          attempt.networkAccess = 'sync_error';
          attempt.networkError = errors.join(' | ');
        } else {
          attempt.networkAccess = 'active';
          attempt.networkError = null;
          attempt.networkSyncedAt = now();
        }
      });
      if (errors.length) console.error('[mikrotik/approve]', errors.join(' | '));
    }
    if (this.party) {
      try { await this.party.ensureComboForAttempt(id); }
      catch (error) { console.error('[party/combo]', error.message); }
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
