import crypto from 'node:crypto';
import { modePlans, publicPlan, planFromAttempt } from './plans.mjs';
import { normalizeWhatsApp, maskWhatsApp, comboMessage, whatsappShareUrl } from './whatsapp.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
function now() { return Date.now(); }
function defaultSettings() {
  return {
    mode: 'standard',
    currentEvent: null,
    lastRemoteControlId: '',
    updatedAt: now()
  };
}
function ensureData(data) {
  data.settings ||= defaultSettings();
  data.settings.mode ||= 'standard';
  data.combos ||= {};
  data.events ||= {};
  data.identities ||= {};
  data.devices ||= {};
  return data;
}
function cleanText(value, max = 120) { return String(value || '').trim().slice(0, max); }
function randomCodeRaw(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
function formatCode(raw) { return `${raw.slice(0,4)}-${raw.slice(4,8)}`; }
function normalizeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function comboPublic(combo) {
  if (!combo) return null;
  return {
    id: combo.id,
    code: combo.code,
    type: combo.type,
    label: combo.label,
    maxDevices: combo.maxDevices,
    usedDevices: (combo.members || []).length,
    availableSlots: Math.max(0, combo.maxDevices - (combo.members || []).length),
    expiresAt: combo.expiresAt,
    eventId: combo.eventId,
    eventName: combo.eventName,
    whatsappMasked: maskWhatsApp(combo.whatsapp),
    whatsappStatus: combo.whatsappStatus || null,
    whatsappShareUrl: combo.whatsappShareUrl || '',
    status: combo.status || 'active'
  };
}

export class PartyService {
  constructor(store, network = null, whatsapp = null) {
    this.store = store;
    this.network = network;
    this.whatsapp = whatsapp;
  }

  settings() {
    return this.store.read(data => {
      ensureData(data);
      return structuredClone(data.settings);
    });
  }

  publicConfig() {
    const settings = this.settings();
    const plans = modePlans(settings.mode);
    return {
      mode: settings.mode,
      event: settings.currentEvent,
      plans: Object.fromEntries(Object.entries(plans).map(([id,p]) => [id, publicPlan(p)]))
    };
  }

  getPlan(planId) {
    const config = this.publicConfig();
    const source = modePlans(config.mode)[planId];
    if (!source) return null;
    return { ...source, mode: config.mode, eventId: config.event?.id || null, eventEndsAt: config.event?.endsAt || null };
  }

  async setMode({ mode, event = null, source = 'local-admin', requestId = '' }) {
    mode = mode === 'party' ? 'party' : 'standard';
    const updated = await this.store.mutate(async data => {
      ensureData(data);
      let currentEvent = data.settings.currentEvent || null;
      if (mode === 'party') {
        const name = cleanText(event?.name || currentEvent?.name || 'Open Wi-Fi Party', 100);
        const startsAt = Number(event?.startsAt || currentEvent?.startsAt || now());
        const endsAt = Number(event?.endsAt || currentEvent?.endsAt || 0);
        if (!Number.isFinite(endsAt) || endsAt <= now()) throw Object.assign(new Error('Defina um horário de término futuro para o Party Mode'), { httpStatus: 400 });
        if (!Number.isFinite(startsAt) || startsAt >= endsAt) throw Object.assign(new Error('O início do evento deve ser anterior ao término'), { httpStatus: 400 });
        const id = cleanText(event?.id || currentEvent?.id || `event-${new Date(startsAt).toISOString().slice(0,10)}-${crypto.randomBytes(3).toString('hex')}`, 120);
        currentEvent = { id, name, startsAt, endsAt, status: 'active', updatedAt: now(), createdAt: currentEvent?.id === id ? currentEvent.createdAt : now() };
        data.events[id] = { ...(data.events[id] || {}), ...currentEvent };
      }
      data.settings.mode = mode;
      data.settings.currentEvent = currentEvent;
      data.settings.updatedAt = now();
      data.settings.updatedBy = source;
      if (requestId) data.settings.lastRemoteControlId = requestId;
      return structuredClone(data.settings);
    });
    return updated;
  }

  accessUntilForAttempt(attempt) {
    const plan = planFromAttempt(attempt);
    if (!plan) throw new Error(`Plano desconhecido: ${attempt.plan}`);
    const t = now();
    if (attempt.mode === 'party' || plan.untilEventEnd || String(attempt.plan).startsWith('party-') || ['night','duo','quartet'].includes(attempt.plan)) {
      const eventEnd = Number(attempt.eventEndsAt || plan.eventEndsAt || 0);
      if (!eventEnd || eventEnd <= t) throw Object.assign(new Error('O evento Party já terminou'), { httpStatus: 409 });
      if (plan.untilEventEnd) return eventEnd;
      return Math.min(t + Number(plan.durationMs || 0), eventEnd);
    }
    return t + Number(plan.durationMs || 0);
  }

  async ensureComboForAttempt(attemptId) {
    const snapshot = this.store.read(data => {
      ensureData(data);
      const attempt = data.attempts?.[attemptId];
      if (!attempt) return null;
      const existing = attempt.comboId ? data.combos?.[attempt.comboId] : null;
      return { attempt: structuredClone(attempt), existing: existing ? structuredClone(existing) : null, event: attempt.eventId ? structuredClone(data.events?.[attempt.eventId] || data.settings.currentEvent) : null };
    });
    if (!snapshot?.attempt) return null;
    if (snapshot.existing) return comboPublic(snapshot.existing);
    const plan = planFromAttempt(snapshot.attempt);
    const slots = Number(plan?.comboSlots || 0);
    if (slots < 2 || snapshot.attempt.status !== 'approved') return null;

    const whatsapp = normalizeWhatsApp(snapshot.attempt.whatsapp || '');
    let selected;
    for (let i = 0; i < 20; i++) {
      const code = formatCode(randomCodeRaw());
      const exists = this.store.read(data => Object.values(data.combos || {}).some(c => normalizeCode(c.code) === normalizeCode(code)));
      if (!exists) { selected = code; break; }
    }
    if (!selected) throw new Error('Não foi possível gerar um código único de combo');
    const comboId = crypto.randomUUID();

    const combo = await this.store.mutate(async data => {
      ensureData(data);
      const attempt = data.attempts?.[attemptId];
      if (!attempt) throw new Error('Tentativa não encontrada ao criar combo');
      if (attempt.comboId && data.combos[attempt.comboId]) return structuredClone(data.combos[attempt.comboId]);
      const identityId = attempt.identityId || attempt.deviceId;
      const identity = data.identities[identityId] ||= { deviceIds: [] };
      const created = {
        id: comboId,
        code: selected,
        type: attempt.plan,
        label: attempt.planLabel || plan.label,
        maxDevices: slots,
        ownerIdentityId: identityId,
        eventId: attempt.eventId || '',
        eventName: snapshot.event?.name || 'Open Wi-Fi Party',
        expiresAt: Number(attempt.accessUntil || snapshot.event?.endsAt || 0),
        whatsapp,
        createdAt: now(),
        status: 'active',
        members: [{ identityId, joinedAt: now(), role: 'owner', deviceIds: [...new Set(identity.deviceIds || [attempt.deviceId])].filter(Boolean) }]
      };
      data.combos[comboId] = created;
      attempt.comboId = comboId;
      return structuredClone(created);
    });

    const send = this.whatsapp ? await this.whatsapp.sendComboInvite({ combo, event: snapshot.event }) : { status: 'disabled', shareUrl: whatsappShareUrl(whatsapp, comboMessage({ combo, event: snapshot.event })) };
    await this.store.mutate(async data => {
      const c = data.combos?.[combo.id];
      if (!c) return;
      c.whatsappStatus = send.status;
      c.whatsappMessageId = send.messageId || null;
      c.whatsappShareUrl = send.shareUrl || whatsappShareUrl(c.whatsapp, comboMessage({ combo: c, event: snapshot.event }));
      c.whatsappLastSendAt = now();
      c.whatsappError = send.error || null;
    });
    return this.getCombo(combo.id);
  }

  getCombo(id) {
    return this.store.read(data => comboPublic(data.combos?.[id]));
  }

  findCombo({ code = '' }) {
    const codeNorm = normalizeCode(code);
    return this.store.read(data => {
      ensureData(data);
      const combo = Object.values(data.combos).find(c => codeNorm && normalizeCode(c.code) === codeNorm);
      if (!combo) return null;
      return structuredClone(combo);
    });
  }

  lookupInvite(input) {
    const combo = this.findCombo(input);
    if (!combo) throw Object.assign(new Error('Convite não encontrado'), { httpStatus: 404 });
    if (combo.status !== 'active' || Number(combo.expiresAt || 0) <= now()) throw Object.assign(new Error('Este convite já expirou'), { httpStatus: 410 });
    return comboPublic(combo);
  }

  async joinCombo({ code = '', identityId, deviceId }) {
    if (!identityId || !deviceId) throw Object.assign(new Error('Não foi possível identificar este aparelho'), { httpStatus: 400 });
    const joined = await this.store.mutate(async data => {
      ensureData(data);
      const codeNorm = normalizeCode(code);
      const combo = Object.values(data.combos).find(c => codeNorm && normalizeCode(c.code) === codeNorm);
      if (!combo) throw Object.assign(new Error('Convite não encontrado'), { httpStatus: 404 });
      if (combo.status !== 'active' || Number(combo.expiresAt || 0) <= now()) throw Object.assign(new Error('Este convite já expirou'), { httpStatus: 410 });
      combo.members ||= [];
      let member = combo.members.find(m => m.identityId === identityId);
      if (!member && combo.members.length >= combo.maxDevices) throw Object.assign(new Error('Este combo já atingiu o limite de aparelhos'), { httpStatus: 409 });
      const identity = data.identities[identityId] ||= { deviceIds: [] };
      identity.deviceIds = [...new Set([...(identity.deviceIds || []), deviceId])];
      identity.accessUntil = Math.max(Number(identity.accessUntil || 0), Number(combo.expiresAt));
      identity.lastApprovedPlan = combo.type;
      identity.lastApprovedPlanLabel = combo.label;
      identity.comboId = combo.id;
      identity.lastSeenAt = now();
      const device = data.devices[deviceId] ||= {};
      device.accessUntil = Math.max(Number(device.accessUntil || 0), Number(combo.expiresAt));
      device.lastApprovedPlan = combo.type;
      device.identityId = identityId;
      device.comboId = combo.id;
      if (!member) {
        member = { identityId, joinedAt: now(), role: 'guest', deviceIds: [deviceId] };
        combo.members.push(member);
      } else {
        member.deviceIds = [...new Set([...(member.deviceIds || []), deviceId])];
        member.lastSeenAt = now();
      }
      combo.updatedAt = now();
      return { combo: structuredClone(combo), deviceIds: [...identity.deviceIds], accessUntil: identity.accessUntil };
    });

    if (this.network?.isReal?.()) {
      const errors = [];
      for (const id of joined.deviceIds) {
        try { await this.network.grantPaid(id, joined.accessUntil, `combo-${joined.combo.id}`, joined.combo.type); }
        catch (error) { errors.push(error.message); }
      }
      if (errors.length) console.error('[party/join/mikrotik]', errors.join(' | '));
    }
    return { ...comboPublic(joined.combo), accessUntil: joined.accessUntil, joined: true };
  }

  async resendInvite(comboId) {
    const combo = this.store.read(data => data.combos?.[comboId] ? structuredClone(data.combos[comboId]) : null);
    if (!combo) throw Object.assign(new Error('Combo não encontrado'), { httpStatus: 404 });
    const event = this.store.read(data => combo.eventId ? structuredClone(data.events?.[combo.eventId] || null) : null);
    const send = this.whatsapp ? await this.whatsapp.sendComboInvite({ combo, event }) : { status: 'disabled', shareUrl: whatsappShareUrl(combo.whatsapp, comboMessage({ combo, event })) };
    await this.store.mutate(async data => {
      const c = data.combos?.[comboId]; if (!c) return;
      c.whatsappStatus = send.status;
      c.whatsappShareUrl = send.shareUrl || c.whatsappShareUrl || '';
      c.whatsappLastSendAt = now();
      c.whatsappError = send.error || null;
    });
    return this.getCombo(comboId);
  }

  listCombos() {
    return this.store.read(data => {
      ensureData(data);
      return Object.values(data.combos).map(c => comboPublic(c)).sort((a,b) => (b.expiresAt||0)-(a.expiresAt||0));
    });
  }

  async sweepExpired() {
    const t = now();
    await this.store.mutate(async data => {
      ensureData(data);
      for (const combo of Object.values(data.combos)) if (combo.status === 'active' && Number(combo.expiresAt || 0) <= t) combo.status = 'expired';
      const event = data.settings.currentEvent;
      if (data.settings.mode === 'party' && event?.endsAt && Number(event.endsAt) <= t) {
        event.status = 'ended';
        data.events[event.id] = { ...(data.events[event.id] || {}), ...event };
        data.settings.mode = 'standard';
        data.settings.updatedAt = t;
        data.settings.updatedBy = 'event-auto-end';
      }
    });
  }
}

export { comboPublic, normalizeCode };
