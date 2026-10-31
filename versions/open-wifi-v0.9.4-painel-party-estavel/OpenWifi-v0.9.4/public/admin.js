const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
let lastData = null;
let selectedMode = 'standard';
let recovered = null;
let modeDirty = false;
let modeSaving = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtDate = ts => ts ? dateFmt.format(new Date(ts)) : '—';
const shortIdentity = id => { const s = String(id || ''); return s.startsWith('OWD:') ? `ID ${s.slice(4, 12).toUpperCase()}` : (s || '—'); };
const localInput = ts => {
  if (!ts) return '';
  const d = new Date(ts), z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
};

async function copyText(text) {
  if (!text) throw new Error('Nada para copiar');
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
}

function metric(label, value, sub = '') { return `<article class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-sub">${esc(sub)}</div></article>`; }
function statusHtml(c) {
  if (c.online && c.paidActive) return '<span class="pill good">Online • pago</span>';
  if (c.online) return '<span class="pill warn">Online</span>';
  if (c.paidActive) return '<span class="pill info">Pago • offline</span>';
  return '<span class="pill">Offline</span>';
}
function renderMetrics(d) {
  const m = d.metrics;
  const base = [
    metric('Conectados agora', m.connectedNow, `${m.paidOnlineNow} com acesso pago`),
    metric('Compras hoje', m.purchasesToday, brl.format(m.grossToday)),
    metric('Faturamento do mês', brl.format(m.grossMonth), `${m.purchasesMonth} compras`),
    metric('Lucro estimado', brl.format(m.estimatedProfitMonth), `taxas ${brl.format(m.estimatedFeesMonth)} • custos ${brl.format(m.monthlyFixedCost)}`),
    metric('Acessos pagos ativos', m.activePaidAccesses, 'inclui clientes offline')
  ];
  if (d.mode === 'party') base.unshift(metric('Evento', brl.format(d.party?.gross || 0), `${d.party?.purchases || 0} vendas no Party`));
  document.querySelector('#metrics').innerHTML = base.join('');
}
function renderClients() {
  if (!lastData) return;
  const q = document.querySelector('#clientSearch').value.toLowerCase().trim();
  const list = lastData.clients.filter(c => !q || [c.hostname, c.mac, c.ip, c.email, c.plan, c.identityId, ...(c.macs || [])].some(v => String(v || '').toLowerCase().includes(q)));
  document.querySelector('#clientsBody').innerHTML = list.length ? list.map(c => `<tr><td>${statusHtml(c)}</td><td><strong>${esc(c.hostname)}</strong><div class="network-meta">${c.macCount > 1 ? `${c.macCount} MACs vinculados` : '1 MAC vinculado'}</div></td><td><div class="network-stack"><span>${esc(c.ip)}</span><code>${esc(c.mac)}</code><code class="device-id">${esc(shortIdentity(c.identityId))}</code></div></td><td>${esc(c.email)}</td><td>${esc(c.plan)}</td><td>${fmtDate(c.accessUntil)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum dispositivo encontrado.</td></tr>';
}
function renderPurchases(d) {
  document.querySelector('#purchasesBody').innerHTML = d.purchases.length ? d.purchases.map(p => `<tr><td>${fmtDate(p.approvedAt)}</td><td><strong>${esc(p.hostname)}</strong><br><code>${esc(p.mac)}</code>${p.macCount > 1 ? `<div class="network-meta">${p.macCount} MACs</div>` : ''}</td><td>${esc(p.email)}</td><td>${esc(p.plan)}</td><td>${brl.format(p.amount)}</td><td>${fmtDate(p.accessUntil)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhuma compra aprovada ainda.</td></tr>';
}
function comboById(id) { return (lastData?.party?.combos || []).find(c => String(c.id) === String(id)); }
function bindComboActions() {
  document.querySelectorAll('[data-copy-code]').forEach(b => b.onclick = async () => { const c = comboById(b.dataset.copyCode); if (c) await copyText(c.code); b.textContent = 'Copiado ✓'; setTimeout(() => b.textContent = 'Código', 1200); });
  document.querySelectorAll('[data-copy-link]').forEach(b => b.onclick = async () => { const c = comboById(b.dataset.copyLink); if (c?.viewUrl) await copyText(c.viewUrl); b.textContent = 'Copiado ✓'; setTimeout(() => b.textContent = 'Link', 1200); });
}

function setEventFields(event) {
  document.querySelector('#eventName').value = event?.name || '';
  document.querySelector('#eventStart').value = localInput(event?.startsAt);
  document.querySelector('#eventEnd').value = localInput(event?.endsAt);
}
function markModeDirty(message = 'Alterações não salvas') {
  if (modeSaving) return;
  modeDirty = true;
  const msg = document.querySelector('#modeMessage');
  if (!msg.textContent || msg.textContent.includes('Sincronizado') || msg.textContent.includes('atualizado')) msg.textContent = message;
  renderMode(lastData);
}
function syncModeDraftFromServer(d) {
  selectedMode = d?.mode || 'standard';
  setEventFields(d?.event || null);
  modeDirty = false;
}
function modeEventDraft() {
  const startsAt = new Date(document.querySelector('#eventStart').value).getTime();
  const endsAt = new Date(document.querySelector('#eventEnd').value).getTime();
  return { name: document.querySelector('#eventName').value.trim() || 'Open Wi-Fi Party', startsAt, endsAt };
}
function validateModeDraft() {
  if (selectedMode !== 'party') return null;
  const event = modeEventDraft();
  if (!Number.isFinite(event.startsAt) || !Number.isFinite(event.endsAt)) throw new Error('Preencha início e fim do evento');
  if (event.endsAt <= Date.now()) throw new Error('O término do evento precisa estar no futuro');
  if (event.startsAt >= event.endsAt) throw new Error('O início precisa ser anterior ao término');
  return event;
}
function renderMode(d, { forceDraft = false } = {}) {
  if (!d) return;
  const activeMode = d.mode || 'standard';
  if (forceDraft || (!modeDirty && !modeSaving)) syncModeDraftFromServer(d);

  // Cabeçalho e cartão "ativo agora" refletem o servidor, nunca o rascunho.
  const ms = document.querySelector('#modeStatus');
  ms.textContent = activeMode === 'party' ? 'Party 🪩' : 'Padrão';
  ms.className = `status-chip ${activeMode === 'party' ? 'party-chip' : 'online'}`;
  document.querySelector('#modeLiveStatus').textContent = activeMode === 'party' ? `Party 🪩${d.event?.name ? ` • ${d.event.name}` : ''}` : 'Padrão';

  // Botões e campos refletem o rascunho local.
  document.querySelector('#standardMode').classList.toggle('active', selectedMode === 'standard');
  document.querySelector('#partyMode').classList.toggle('active', selectedMode === 'party');
  document.querySelector('#eventFields').classList.toggle('hidden', selectedMode !== 'party');

  const draftCard = document.querySelector('.mode-state-card.draft');
  draftCard.classList.toggle('dirty', modeDirty && !modeSaving);
  draftCard.classList.toggle('pending', modeSaving);
  document.querySelector('#modeDraftStatus').textContent = modeSaving ? 'Salvando…' : (modeDirty ? 'Alterações não salvas' : 'Sincronizada');
  document.querySelector('#discardMode').classList.toggle('hidden', !modeDirty || modeSaving);
  document.querySelector('#saveMode').disabled = modeSaving;
  document.querySelector('#standardMode').disabled = modeSaving;
  document.querySelector('#partyMode').disabled = modeSaving;

  // Combos seguem o modo realmente ativo; selecionar Party sem salvar não muda a operação.
  document.querySelector('#combosPanel').classList.toggle('hidden', activeMode !== 'party');
  const combos = d.party?.combos || [];
  document.querySelector('#combosBody').innerHTML = combos.length ? combos.map(c => `<tr><td><code class="combo-admin-code">${esc(c.code)}</code></td><td>${esc(c.label)}</td><td>${c.usedDevices}/${c.maxDevices}<div class="network-meta">vagas imutáveis</div></td><td>${fmtDate(c.expiresAt)}</td><td>${esc(c.whatsappMasked)}</td><td><button class="mini-btn" data-copy-code="${esc(c.id)}">Código</button> <button class="mini-btn" data-copy-link="${esc(c.id)}">Link</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum combo neste evento.</td></tr>';
  bindComboActions();
}

async function load({ forceMode = false } = {}) {
  const btn = document.querySelector('#refreshBtn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/admin/dashboard', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/admin-login.html'; return; }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Falha ao carregar painel');
    lastData = d;
    renderMetrics(d); renderClients(); renderPurchases(d); renderMode(d, { forceDraft: forceMode });
    document.querySelector('#updatedAt').textContent = `Atualizado ${fmtDate(d.generatedAt)} • ${d.timezone}`;
    const rs = document.querySelector('#routerStatus');
    rs.textContent = d.router.online ? `RB online • ${d.router.connectedHosts} hosts` : 'RB offline';
    rs.className = `status-chip ${d.router.online ? 'online' : 'offline'}`;
    if (d.router.error) rs.title = d.router.error;
  } catch (e) {
    document.querySelector('#updatedAt').textContent = `Erro: ${e.message}`;
  } finally { btn.disabled = false; }
}

document.querySelector('#standardMode').onclick = () => { selectedMode = 'standard'; markModeDirty(); };
document.querySelector('#partyMode').onclick = () => {
  selectedMode = 'party';
  if (!document.querySelector('#eventStart').value) document.querySelector('#eventStart').value = localInput(Date.now());
  if (!document.querySelector('#eventEnd').value) document.querySelector('#eventEnd').value = localInput(Date.now() + 8 * 60 * 60 * 1000);
  markModeDirty();
};
['eventName', 'eventStart', 'eventEnd'].forEach(id => document.querySelector(`#${id}`).addEventListener('input', () => markModeDirty()));
document.querySelector('#discardMode').onclick = () => {
  if (!lastData || modeSaving) return;
  syncModeDraftFromServer(lastData);
  document.querySelector('#modeMessage').textContent = 'Alterações descartadas';
  renderMode(lastData);
};
document.querySelector('#saveMode').onclick = async () => {
  if (modeSaving) return;
  const msg = document.querySelector('#modeMessage');
  try {
    const event = validateModeDraft();
    modeSaving = true; renderMode(lastData); msg.textContent = 'Salvando configuração…';
    const r = await fetch('/api/admin/party', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: selectedMode, event }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Falha ao salvar');
    modeDirty = false;
    msg.textContent = 'Modo aplicado com sucesso ✓';
    await load({ forceMode: true });
  } catch (e) {
    modeDirty = true;
    msg.textContent = `Erro: ${e.message}`;
  } finally {
    modeSaving = false;
    renderMode(lastData);
  }
};

document.querySelector('#recoverGroup').onclick = async () => {
  const phone = document.querySelector('#recoverPhone').value.trim(), msg = document.querySelector('#recoverMessage');
  msg.textContent = 'Buscando…'; document.querySelector('#recoverResult').classList.add('hidden');
  try {
    const r = await fetch(`/api/admin/party/recover?phone=${encodeURIComponent(phone)}`, { cache: 'no-store' }), j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Grupo não encontrado');
    recovered = j; document.querySelector('#recoverCode').textContent = j.code; document.querySelector('#recoverSlots').textContent = `${j.usedDevices}/${j.maxDevices} vagas • ${j.label}`; document.querySelector('#recoverResult').classList.remove('hidden'); msg.textContent = 'Grupo encontrado ✓';
  } catch (e) { recovered = null; msg.textContent = e.message; }
};
document.querySelector('#recoverCopyCode').onclick = async () => { if (recovered?.code) await copyText(recovered.code); };
document.querySelector('#recoverCopyLink').onclick = async () => { if (recovered?.viewUrl) await copyText(recovered.viewUrl); };
document.querySelector('#refreshBtn').onclick = () => load();
document.querySelector('#clientSearch').addEventListener('input', renderClients);
document.querySelector('#logoutBtn').onclick = async () => { await fetch('/api/admin/logout', { method: 'POST' }); location.href = '/admin-login.html'; };

load({ forceMode: true });
setInterval(() => load(), 5000);
