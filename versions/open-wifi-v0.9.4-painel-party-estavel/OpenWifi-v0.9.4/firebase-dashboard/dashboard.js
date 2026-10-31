import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { getFirestore, doc, collection, query, orderBy, limit, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { firebaseConfig, OPENWIFI_SITE_ID } from './firebase-config.js';

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app), provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtDate = ts => ts ? dateFmt.format(new Date(Number(ts))) : '—';
const shortIdentity = id => { const s = String(id || ''); return s.startsWith('OWD:') ? `ID ${s.slice(4, 12).toUpperCase()}` : (s || '—'); };
const localInput = ts => { if (!ts) return ''; const d = new Date(Number(ts)), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };

let siteData = null, clients = [], purchases = [], combos = [], unsubscribers = [], selectedMode = 'standard', recovered = null;
let modeDirty = false, pendingModeRequest = null, lastControlStatus = null;

async function copyText(text) {
  if (!text) throw new Error('Nada para copiar');
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
}
function metric(label, value, sub = '') { return `<article class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-sub">${esc(sub)}</div></article>`; }
function statusHtml(c) { if (c.online && c.paidActive) return '<span class="pill good">Online • pago</span>'; if (c.online) return '<span class="pill warn">Online</span>'; if (c.paidActive) return '<span class="pill info">Pago • offline</span>'; return '<span class="pill">Offline</span>'; }

function setEventFields(event) {
  document.querySelector('#eventName').value = event?.name || '';
  document.querySelector('#eventStart').value = localInput(event?.startsAt);
  document.querySelector('#eventEnd').value = localInput(event?.endsAt);
}
function syncModeDraftFromCloud() {
  selectedMode = siteData?.mode || 'standard';
  setEventFields(siteData?.event || null);
  modeDirty = false;
}
function modeEventDraft() {
  return {
    name: document.querySelector('#eventName').value.trim() || 'Open Wi-Fi Party',
    startsAt: new Date(document.querySelector('#eventStart').value).getTime(),
    endsAt: new Date(document.querySelector('#eventEnd').value).getTime()
  };
}
function validateModeDraft() {
  if (selectedMode !== 'party') return null;
  const event = modeEventDraft();
  if (!Number.isFinite(event.startsAt) || !Number.isFinite(event.endsAt)) throw new Error('Preencha início e fim do evento');
  if (event.endsAt <= Date.now()) throw new Error('O término do evento precisa estar no futuro');
  if (event.startsAt >= event.endsAt) throw new Error('O início precisa ser anterior ao término');
  return event;
}
function markModeDirty() {
  if (pendingModeRequest) return;
  modeDirty = true;
  const msg = document.querySelector('#modeMessage');
  if (!msg.textContent || msg.textContent.includes('aplicad') || msg.textContent.includes('Sincroniz')) msg.textContent = 'Alterações não aplicadas';
  renderMode();
}
function modeMatchesPending() {
  if (!pendingModeRequest || !siteData) return false;
  if ((siteData.mode || 'standard') !== pendingModeRequest.mode) return false;
  if (pendingModeRequest.mode !== 'party') return true;
  const e = siteData.event || {};
  const p = pendingModeRequest.event || {};
  return String(e.name || '') === String(p.name || '') && Number(e.startsAt || 0) === Number(p.startsAt || 0) && Number(e.endsAt || 0) === Number(p.endsAt || 0);
}
function settlePendingIfPossible() {
  if (!pendingModeRequest) return;
  if (lastControlStatus?.requestId === pendingModeRequest.requestId) {
    if (lastControlStatus.ok === false) {
      document.querySelector('#modeMessage').textContent = `Erro ao aplicar: ${lastControlStatus.error || 'falha no agente'}`;
      pendingModeRequest = null;
      modeDirty = true;
      renderMode();
      return;
    }
    if (lastControlStatus.ok === true && modeMatchesPending()) {
      document.querySelector('#modeMessage').textContent = 'Modo aplicado pelo agente ✓';
      pendingModeRequest = null;
      modeDirty = false;
      syncModeDraftFromCloud();
      renderMode();
    }
  } else if (modeMatchesPending()) {
    // Fallback caso o documento de status chegue depois do snapshot principal.
    document.querySelector('#modeMessage').textContent = 'Modo aplicado ✓';
    pendingModeRequest = null;
    modeDirty = false;
    syncModeDraftFromCloud();
    renderMode();
  }
}

function renderSite() {
  if (!siteData) return;
  const m = siteData.metrics || {};
  const arr = [
    metric('Conectados agora', m.connectedNow ?? 0, `${m.paidOnlineNow ?? 0} com acesso pago`),
    metric('Compras hoje', m.purchasesToday ?? 0, brl.format(m.grossToday ?? 0)),
    metric('Faturamento do mês', brl.format(m.grossMonth ?? 0), `${m.purchasesMonth ?? 0} compras`),
    metric('Lucro estimado', brl.format(m.estimatedProfitMonth ?? 0), `taxas ${brl.format(m.estimatedFeesMonth ?? 0)} • custos ${brl.format(m.monthlyFixedCost ?? 0)}`),
    metric('Acessos pagos ativos', m.activePaidAccesses ?? 0, 'inclui clientes offline')
  ];
  if (siteData.mode === 'party') arr.unshift(metric('Evento', brl.format(siteData.party?.gross ?? 0), `${siteData.party?.purchases ?? 0} vendas no Party`));
  document.querySelector('#metrics').innerHTML = arr.join('');
  const generated = Number(siteData.generatedAt || siteData.syncedAt || 0), age = generated ? Math.max(0, Date.now() - generated) : Infinity;
  document.querySelector('#updatedAt').textContent = generated ? `Atualizado ${fmtDate(generated)} • ${siteData.timezone || 'America/Sao_Paulo'}${age > 30000 ? ' • dados atrasados' : ''}` : 'Aguardando o agente local…';
  const ag = document.querySelector('#agentStatus'), agentOnline = Boolean(siteData.agent?.online) && age < 30000, rs = document.querySelector('#routerStatus'), routerOnline = agentOnline && Boolean(siteData.router?.online);
  rs.textContent = !agentOnline ? 'RB sem atualização' : (routerOnline ? `RB online • ${siteData.router?.connectedHosts ?? 0} hosts` : 'RB offline');
  rs.className = `status-chip ${routerOnline ? 'online' : 'offline'}`;
  ag.textContent = agentOnline ? 'Agente online' : 'Agente sem sinal'; ag.className = `status-chip ${agentOnline ? 'online' : 'offline'}`;

  if (!modeDirty && !pendingModeRequest) syncModeDraftFromCloud();
  settlePendingIfPossible();
  renderMode();
}

function renderMode() {
  const activeMode = siteData?.mode || 'standard';
  const pending = Boolean(pendingModeRequest);

  document.querySelector('#standardMode').classList.toggle('active', selectedMode === 'standard');
  document.querySelector('#partyMode').classList.toggle('active', selectedMode === 'party');
  document.querySelector('#eventFields').classList.toggle('hidden', selectedMode !== 'party');

  const ms = document.querySelector('#modeStatus');
  ms.textContent = activeMode === 'party' ? 'Party 🪩' : 'Padrão';
  ms.className = `status-chip ${activeMode === 'party' ? 'party-chip' : 'online'}`;
  document.querySelector('#modeLiveStatus').textContent = activeMode === 'party' ? `Party 🪩${siteData?.event?.name ? ` • ${siteData.event.name}` : ''}` : 'Padrão';

  const draftCard = document.querySelector('.mode-state-card.draft');
  draftCard.classList.toggle('dirty', modeDirty && !pending);
  draftCard.classList.toggle('pending', pending);
  document.querySelector('#modeDraftStatus').textContent = pending ? 'Aguardando agente…' : (modeDirty ? 'Alterações não aplicadas' : 'Sincronizada');
  document.querySelector('#discardMode').classList.toggle('hidden', (!modeDirty && !pending) || pending);
  document.querySelector('#saveMode').disabled = pending;
  document.querySelector('#standardMode').disabled = pending;
  document.querySelector('#partyMode').disabled = pending;
  ['eventName', 'eventStart', 'eventEnd'].forEach(id => document.querySelector(`#${id}`).disabled = pending);

  // Combos exibem o evento realmente ativo, não o rascunho ainda não aplicado.
  document.querySelector('#combosPanel').classList.toggle('hidden', activeMode !== 'party');
  const visibleCombos = combos.filter(c => !siteData?.event?.id || c.eventId === siteData.event.id);
  document.querySelector('#combosBody').innerHTML = visibleCombos.length ? visibleCombos.map(c => `<tr><td><code class="combo-admin-code">${esc(c.code)}</code></td><td>${esc(c.label)}</td><td>${c.usedDevices}/${c.maxDevices}<div class="network-meta">vagas imutáveis</div></td><td>${fmtDate(c.expiresAt)}</td><td>${esc(c.whatsappMasked || '—')}</td><td><button class="mini-btn" data-copy-code="${esc(c.id)}">Código</button> <button class="mini-btn" data-copy-link="${esc(c.id)}">Link</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum combo neste evento.</td></tr>';
  document.querySelectorAll('[data-copy-code]').forEach(b => b.onclick = async () => { const c = combos.find(x => String(x.id) === String(b.dataset.copyCode)); if (c) await copyText(c.code); b.textContent = 'Copiado ✓'; setTimeout(() => b.textContent = 'Código', 1200); });
  document.querySelectorAll('[data-copy-link]').forEach(b => b.onclick = async () => { const c = combos.find(x => String(x.id) === String(b.dataset.copyLink)); if (c?.viewUrl) await copyText(c.viewUrl); b.textContent = 'Copiado ✓'; setTimeout(() => b.textContent = 'Link', 1200); });
}

function renderClients() {
  const q = document.querySelector('#clientSearch').value.toLowerCase().trim();
  const list = clients.filter(c => !q || [c.hostname, c.mac, c.ip, c.email, c.plan, c.identityId, ...(c.macs || [])].some(v => String(v || '').toLowerCase().includes(q)));
  document.querySelector('#clientsBody').innerHTML = list.length ? list.map(c => `<tr><td>${statusHtml(c)}</td><td><strong>${esc(c.hostname || 'Dispositivo sem nome')}</strong><div class="network-meta">${c.macCount > 1 ? `${c.macCount} MACs vinculados` : '1 MAC vinculado'}</div></td><td><div class="network-stack"><span>${esc(c.ip || '—')}</span><code>${esc(c.mac || '—')}</code><code class="device-id">${esc(shortIdentity(c.identityId))}</code></div></td><td>${esc(c.email || '—')}</td><td>${esc(c.plan || '—')}</td><td>${fmtDate(c.accessUntil)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum dispositivo encontrado.</td></tr>';
}
function renderPurchases() {
  document.querySelector('#purchasesBody').innerHTML = purchases.length ? purchases.map(p => `<tr><td>${fmtDate(p.approvedAt)}</td><td><strong>${esc(p.hostname || 'Dispositivo sem nome')}</strong><br><code>${esc(p.mac || '—')}</code></td><td>${esc(p.email || '—')}</td><td>${esc(p.plan || '—')}</td><td>${brl.format(p.amount || 0)}</td><td>${fmtDate(p.accessUntil)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhuma compra aprovada ainda.</td></tr>';
}
function stopListeners() { for (const u of unsubscribers) try { u(); } catch {} unsubscribers = []; }
function permissionMessage(user, error) { const el = document.querySelector('#permissionHelp'); el.classList.remove('hidden'); el.innerHTML = `<strong>Conta autenticada, mas sem permissão no Firestore.</strong><br>E-mail: <code>${esc(user?.email || '—')}</code><br>UID: <code>${esc(user?.uid || '—')}</code><br><small>${esc(error?.message || '')}</small>`; }
function listen(user) {
  stopListeners(); document.querySelector('#permissionHelp').classList.add('hidden');
  const base = ['openwifi_sites', OPENWIFI_SITE_ID];
  unsubscribers.push(onSnapshot(doc(db, ...base), s => { siteData = s.exists() ? s.data() : null; renderSite(); }, e => permissionMessage(user, e)));
  unsubscribers.push(onSnapshot(collection(db, ...base, 'clients'), s => { clients = s.docs.map(d => d.data()).sort((a, b) => Number(b.online) - Number(a.online) || Number(b.paidActive) - Number(a.paidActive)); renderClients(); }, e => permissionMessage(user, e)));
  unsubscribers.push(onSnapshot(query(collection(db, ...base, 'purchases'), orderBy('approvedAt', 'desc'), limit(100)), s => { purchases = s.docs.map(d => d.data()); renderPurchases(); }, e => permissionMessage(user, e)));
  unsubscribers.push(onSnapshot(collection(db, ...base, 'combos'), s => { combos = s.docs.map(d => d.data()).sort((a, b) => Number(b.expiresAt || 0) - Number(a.expiresAt || 0)); renderMode(); }, e => permissionMessage(user, e)));
  unsubscribers.push(onSnapshot(doc(db, ...base, 'control', 'status'), s => { lastControlStatus = s.exists() ? s.data() : null; settlePendingIfPossible(); renderMode(); }, e => permissionMessage(user, e)));
}
async function googleLogin() {
  document.querySelector('#loginError').textContent = '';
  try { await signInWithPopup(auth, provider); }
  catch (error) { if (['auth/popup-blocked', 'auth/cancelled-popup-request', 'auth/web-storage-unsupported'].includes(error.code)) { await signInWithRedirect(auth, provider); return; } document.querySelector('#loginError').textContent = error.message; }
}

document.querySelector('#standardMode').onclick = () => { selectedMode = 'standard'; markModeDirty(); };
document.querySelector('#partyMode').onclick = () => {
  selectedMode = 'party';
  if (!document.querySelector('#eventStart').value) document.querySelector('#eventStart').value = localInput(Date.now());
  if (!document.querySelector('#eventEnd').value) document.querySelector('#eventEnd').value = localInput(Date.now() + 8 * 60 * 60 * 1000);
  markModeDirty();
};
['eventName', 'eventStart', 'eventEnd'].forEach(id => document.querySelector(`#${id}`).addEventListener('input', markModeDirty));
document.querySelector('#discardMode').onclick = () => {
  if (!siteData || pendingModeRequest) return;
  syncModeDraftFromCloud();
  document.querySelector('#modeMessage').textContent = 'Alterações descartadas';
  renderMode();
};
document.querySelector('#saveMode').onclick = async () => {
  if (pendingModeRequest) return;
  const msg = document.querySelector('#modeMessage');
  try {
    const event = validateModeDraft();
    const requestId = crypto.randomUUID();
    pendingModeRequest = { requestId, mode: selectedMode, event };
    modeDirty = false;
    msg.textContent = 'Solicitação enviada. Aguardando o agente local…';
    renderMode();
    await setDoc(doc(db, 'openwifi_sites', OPENWIFI_SITE_ID, 'control', 'desired'), { requestId, mode: selectedMode, event, requestedAt: Date.now(), requestedBy: auth.currentUser?.email || '' });
  } catch (e) {
    pendingModeRequest = null;
    modeDirty = true;
    msg.textContent = `Erro: ${e.message}`;
    renderMode();
  }
};

document.querySelector('#recoverGroup').onclick = () => {
  const raw = document.querySelector('#recoverPhone').value.replace(/\D/g, '');
  const key = (raw.length === 10 || raw.length === 11) ? `55${raw}` : raw;
  const matches = combos.filter(c => String(c.whatsapp || '') === key).sort((a, b) => Number(b.expiresAt || 0) - Number(a.expiresAt || 0));
  const c = matches[0], msg = document.querySelector('#recoverMessage');
  if (!c) { recovered = null; document.querySelector('#recoverResult').classList.add('hidden'); msg.textContent = 'Nenhum grupo encontrado para este WhatsApp.'; return; }
  recovered = c; document.querySelector('#recoverCode').textContent = c.code; document.querySelector('#recoverSlots').textContent = `${c.usedDevices}/${c.maxDevices} vagas • ${c.label}`; document.querySelector('#recoverResult').classList.remove('hidden'); msg.textContent = 'Grupo encontrado ✓';
};
document.querySelector('#recoverCopyCode').onclick = async () => { if (recovered?.code) await copyText(recovered.code); };
document.querySelector('#recoverCopyLink').onclick = async () => { if (recovered?.viewUrl) await copyText(recovered.viewUrl); };
document.querySelector('#googleLogin').onclick = googleLogin;
document.querySelector('#logoutBtn').onclick = () => signOut(auth);
document.querySelector('#clientSearch').addEventListener('input', renderClients);
onAuthStateChanged(auth, user => {
  stopListeners();
  if (!user) { document.querySelector('#loginView').classList.remove('hidden'); document.querySelector('#appView').classList.add('hidden'); return; }
  document.querySelector('#loginView').classList.add('hidden'); document.querySelector('#appView').classList.remove('hidden'); document.querySelector('#userLabel').textContent = user.email || user.displayName || 'Admin'; listen(user);
});
