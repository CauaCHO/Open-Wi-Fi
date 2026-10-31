import crypto from 'node:crypto';
import { modePlans, publicPlan, planFromAttempt } from './plans.mjs';
import { normalizeWhatsApp, maskWhatsApp } from './whatsapp.mjs';

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
  data.comboByPhone ||= {};
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
function groupViewBaseUrl() {
  return String(process.env.PARTY_GROUP_VIEW_BASE_URL || 'https://open-wi-fi-ofc.web.app/group.html').trim();
}
function groupViewUrl(token) {
  if (!token) return '';
  const base = groupViewBaseUrl();
  return `${base}${base.includes('?') ? '&' : '?'}g=${encodeURIComponent(token)}`;
}
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
    viewUrl: groupViewUrl(combo.viewToken),
    status: combo.status || 'active',
    membersImmutable: true
  };
}

export class PartyService {
  constructor(store, network = null) {
    this.store = store;
    this.network = network;
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
    return this.store.mutate(async data => {
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
    if (!whatsapp) throw new Error('Compra Party sem WhatsApp válido para criar o grupo');

    let selected;
    for (let i = 0; i < 20; i++) {
      const code = formatCode(randomCodeRaw());
      const exists = this.store.read(data => Object.values(data.combos || {}).some(c => normalizeCode(c.code) === normalizeCode(code)));
      if (!exists) { selected = code; break; }
    }
    if (!selected) throw new Error('Não foi possível gerar um código único de combo');
    const comboId = crypto.randomUUID();
    const viewToken = crypto.randomBytes(24).toString('base64url');

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
        viewToken,
        type: attempt.plan,
        label: attempt.planLabel || plan.label,
        maxDevices: slots,
        ownerIdentityId: identityId,
        eventId: attempt.eventId || '',
        eventName: snapshot.event?.name || 'Open Wi-Fi Party',
        expiresAt: Number(attempt.accessUntil || snapshot.event?.endsAt || 0),
        whatsapp,
        createdAt: now(),
        updatedAt: now(),
        status: 'active',
        membersImmutable: true,
        members: [{ identityId, joinedAt: now(), role: 'owner', deviceIds: [...new Set(identity.deviceIds || [attempt.deviceId])].filter(Boolean) }]
      };
      data.combos[comboId] = created;
      // O número é a chave principal de recuperação: aponta sempre para o grupo
      // mais recente comprado por esse telefone. O ID interno continua único para
      // preservar histórico caso o mesmo número compre outro combo futuramente.
      data.comboByPhone[whatsapp] = comboId;
      attempt.comboId = comboId;
      return structuredClone(created);
    });

    return comboPublic(combo);
  }

  getCombo(id) {
    return this.store.read(data => comboPublic(data.combos?.[id]));
  }

  findCombo({ code = '' }) {
    const codeNorm = normalizeCode(code);
    return this.store.read(data => {
      ensureData(data);
      const combo = Object.values(data.combos).find(c => codeNorm && normalizeCode(c.code) === codeNorm);
      return combo ? structuredClone(combo) : null;
    });
  }

  findComboByPhone(phone) {
    const key = normalizeWhatsApp(phone);
    if (!key) return null;
    return this.store.read(data => {
      ensureData(data);
      const indexed = data.comboByPhone?.[key] ? data.combos?.[data.comboByPhone[key]] : null;
      if (indexed) return structuredClone(indexed);
      const matches = Object.values(data.combos || {}).filter(c => normalizeWhatsApp(c.whatsapp) === key).sort((a,b) => Number(b.createdAt||0)-Number(a.createdAt||0));
      return matches[0] ? structuredClone(matches[0]) : null;
    });
  }

  recoverByPhone(phone) {
    const combo = this.findComboByPhone(phone);
    if (!combo) throw Object.assign(new Error('Nenhum grupo encontrado para este WhatsApp'), { httpStatus: 404 });
    return {
      ...comboPublic(combo),
      whatsapp: normalizeWhatsApp(combo.whatsapp),
      recoveryKey: normalizeWhatsApp(combo.whatsapp)
    };
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
      const previousDevice = data.devices?.[deviceId] || {};
      if (previousDevice.comboId && previousDevice.comboId !== combo.id) {
        const locked = data.combos?.[previousDevice.comboId];
        if (locked && locked.status === 'active' && Number(locked.expiresAt || 0) > now()) {
          throw Object.assign(new Error('Este MAC já está vinculado a outro grupo ativo e não pode ser trocado'), { httpStatus: 409 });
        }
      }
      const identity = data.identities[identityId] ||= { deviceIds: [] };
      if (identity.comboId && identity.comboId !== combo.id) {
        const locked = data.combos?.[identity.comboId];
        if (locked && locked.status === 'active' && Number(locked.expiresAt || 0) > now()) {
          throw Object.assign(new Error('Este aparelho já está vinculado a outro grupo ativo e não pode ser trocado'), { httpStatus: 409 });
        }
      }

      // Primeiro procura pelo Device ID; se o navegador perdeu o cookie, o MAC já
      // registrado também recupera a vaga antiga em vez de consumir uma nova.
      let member = combo.members.find(m => m.identityId === identityId) || combo.members.find(m => (m.deviceIds || []).includes(deviceId));
      if (!member && combo.members.length >= combo.maxDevices) throw Object.assign(new Error('Este combo já atingiu o limite de aparelhos'), { httpStatus: 409 });

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
        // Vaga imutável: depois que um Device ID ocupa uma vaga, não existe rota
        // para excluí-lo ou substituir o membro durante a validade do grupo.
        member = { identityId, joinedAt: now(), role: 'guest', deviceIds: [deviceId] };
        combo.members.push(member);
      } else {
        // Um novo MAC do mesmo Device ID — ou o mesmo MAC reaparecendo após perda
        // do cookie — reutiliza a vaga já ocupada.
        member.deviceIds = [...new Set([...(member.deviceIds || []), deviceId])];
        if (member.identityId !== identityId) member.aliasIdentityIds = [...new Set([...(member.aliasIdentityIds || []), identityId])];
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

  listCombos() {
    return this.store.read(data => {
      ensureData(data);
      return Object.values(data.combos).map(c => comboPublic(c)).sort((a,b) => (b.expiresAt||0)-(a.expiresAt||0));
    });
  }

  listPublicGroupViews(clients = []) {
    const clientByIdentity = new Map((clients || []).map(c => [String(c.identityId || c.deviceKey || ''), c]));
    return this.store.read(data => {
      ensureData(data);
      return Object.values(data.combos || {}).filter(c => c.viewToken).map(combo => {
        const members = (combo.members || []).map((member, index) => {
          const client = clientByIdentity.get(String(member.identityId || '')) || {};
          const ids = [...new Set([...(member.deviceIds || []), ...((data.identities?.[member.identityId]?.deviceIds) || [])])];
          const primaryMac = String(client.mac || ids.find(x => /([0-9A-F]{2}:){5}[0-9A-F]{2}/i.test(String(x))) || '');
          const macTail = primaryMac ? primaryMac.replace(/^MAC:/i,'').split(':').slice(-2).join(':') : '';
          return {
            position: index + 1,
            role: member.role || 'guest',
            name: client.hostname && client.hostname !== 'Dispositivo sem nome' ? client.hostname : `Aparelho ${index + 1}`,
            online: Boolean(client.online),
            joinedAt: member.joinedAt || null,
            macCount: Number(client.macCount || ids.length || 1),
            macTail: macTail || null
          };
        });
        return {
          token: combo.viewToken,
          data: {
            code: combo.code,
            label: combo.label || combo.type,
            eventName: combo.eventName || 'Open Wi-Fi Party',
            maxDevices: Number(combo.maxDevices || 0),
            usedDevices: members.length,
            availableSlots: Math.max(0, Number(combo.maxDevices || 0) - members.length),
            expiresAt: combo.expiresAt || null,
            status: combo.status || 'active',
            membersImmutable: true,
            members,
            updatedAt: now()
          }
        };
      });
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

export { comboPublic, normalizeCode, groupViewUrl };
