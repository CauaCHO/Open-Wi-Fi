import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { getFirestore, doc, collection, query, orderBy, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { firebaseConfig, OPENWIFI_SITE_ID } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtDate = ts => ts ? dateFmt.format(new Date(Number(ts))) : '—';
const shortIdentity = id => { const s = String(id || ''); return s.startsWith('OWD:') ? `ID ${s.slice(4,12).toUpperCase()}` : (s || '—'); };
let siteData = null;
let clients = [];
let purchases = [];
let unsubscribers = [];

function metric(label, value, sub='') {
  return `<article class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-sub">${esc(sub)}</div></article>`;
}
function statusHtml(c) {
  if (c.online && c.paidActive) return '<span class="pill good">Online • pago</span>';
  if (c.online) return '<span class="pill warn">Online</span>';
  if (c.paidActive) return '<span class="pill info">Pago • offline</span>';
  return '<span class="pill">Offline</span>';
}
function renderSite() {
  if (!siteData) return;
  const m = siteData.metrics || {};
  document.querySelector('#metrics').innerHTML = [
    metric('Conectados agora', m.connectedNow ?? 0, `${m.paidOnlineNow ?? 0} com acesso pago`),
    metric('Compras hoje', m.purchasesToday ?? 0, brl.format(m.grossToday ?? 0)),
    metric('Faturamento do mês', brl.format(m.grossMonth ?? 0), `${m.purchasesMonth ?? 0} compras`),
    metric('Lucro estimado', brl.format(m.estimatedProfitMonth ?? 0), `taxas ${brl.format(m.estimatedFeesMonth ?? 0)} • custos ${brl.format(m.monthlyFixedCost ?? 0)}`),
    metric('Acessos pagos ativos', m.activePaidAccesses ?? 0, 'inclui clientes offline')
  ].join('');

  const generated = Number(siteData.generatedAt || siteData.syncedAt || 0);
  const age = generated ? Math.max(0, Date.now() - generated) : Infinity;
  document.querySelector('#updatedAt').textContent = generated
    ? `Atualizado ${fmtDate(generated)} • ${siteData.timezone || 'America/Sao_Paulo'}${age > 30000 ? ' • dados atrasados' : ''}`
    : 'Aguardando o agente local…';

  const ag = document.querySelector('#agentStatus');
  const agentOnline = Boolean(siteData.agent?.online) && age < 30000;
  const rs = document.querySelector('#routerStatus');
  const routerOnline = agentOnline && Boolean(siteData.router?.online);
  rs.textContent = !agentOnline ? 'RB sem atualização' : (routerOnline ? `RB online • ${siteData.router?.connectedHosts ?? 0} hosts` : 'RB offline');
  rs.className = `status-chip ${routerOnline ? 'online' : 'offline'}`;
  ag.textContent = agentOnline ? 'Agente online' : 'Agente sem sinal';
  ag.className = `status-chip ${agentOnline ? 'online' : 'offline'}`;
}
function renderClients() {
  const q = document.querySelector('#clientSearch').value.toLowerCase().trim();
  const list = clients.filter(c => !q || [c.hostname,c.mac,c.ip,c.email,c.plan,c.identityId,...(c.macs||[])].some(v => String(v || '').toLowerCase().includes(q)));
  document.querySelector('#clientsBody').innerHTML = list.length ? list.map(c => `<tr>
    <td>${statusHtml(c)}</td>
    <td><strong>${esc(c.hostname || 'Dispositivo sem nome')}</strong><div class="network-meta">${c.macCount > 1 ? `${c.macCount} MACs vinculados` : '1 MAC vinculado'}</div></td>
    <td><div class="network-stack"><span>${esc(c.ip || '—')}</span><code>${esc(c.mac || '—')}</code><code class="device-id">${esc(shortIdentity(c.identityId))}</code></div></td>
    <td>${esc(c.email || '—')}</td><td>${esc(c.plan || '—')}</td><td>${fmtDate(c.accessUntil)}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhum dispositivo encontrado.</td></tr>';
}
function renderPurchases() {
  document.querySelector('#purchasesBody').innerHTML = purchases.length ? purchases.map(p => `<tr>
    <td>${fmtDate(p.approvedAt)}</td><td><strong>${esc(p.hostname || 'Dispositivo sem nome')}</strong><br><code>${esc(p.mac || '—')}</code>${p.macCount > 1 ? `<div class="network-meta">${p.macCount} MACs no Device ID</div>` : ''}</td><td>${esc(p.email || '—')}</td><td>${esc(p.plan || '—')}</td><td>${brl.format(p.amount || 0)}</td><td>${fmtDate(p.accessUntil)}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty">Nenhuma compra aprovada ainda.</td></tr>';
}
function stopListeners() {
  for (const unsub of unsubscribers) try { unsub(); } catch {}
  unsubscribers = [];
}
function permissionMessage(user, error) {
  const el = document.querySelector('#permissionHelp');
  el.classList.remove('hidden');
  el.innerHTML = `<strong>Conta autenticada, mas sem permissão no Firestore.</strong><br>E-mail: <code>${esc(user?.email || '—')}</code><br>UID: <code>${esc(user?.uid || '—')}</code><br><small>${esc(error?.message || '')}</small>`;
}
function listen(user) {
  stopListeners();
  document.querySelector('#permissionHelp').classList.add('hidden');
  const siteRef = doc(db, 'openwifi_sites', OPENWIFI_SITE_ID);
  unsubscribers.push(onSnapshot(siteRef, snap => {
    siteData = snap.exists() ? snap.data() : null;
    renderSite();
  }, error => permissionMessage(user, error)));

  unsubscribers.push(onSnapshot(collection(db, 'openwifi_sites', OPENWIFI_SITE_ID, 'clients'), snap => {
    clients = snap.docs.map(d => d.data()).sort((a,b) => Number(b.online)-Number(a.online) || Number(b.paidActive)-Number(a.paidActive) || Number(b.lastPurchaseAt||0)-Number(a.lastPurchaseAt||0));
    renderClients();
  }, error => permissionMessage(user, error)));

  const purchasesQuery = query(collection(db, 'openwifi_sites', OPENWIFI_SITE_ID, 'purchases'), orderBy('approvedAt','desc'), limit(100));
  unsubscribers.push(onSnapshot(purchasesQuery, snap => {
    purchases = snap.docs.map(d => d.data());
    renderPurchases();
  }, error => permissionMessage(user, error)));
}

async function googleLogin() {
  document.querySelector('#loginError').textContent = '';
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (['auth/popup-blocked','auth/cancelled-popup-request','auth/web-storage-unsupported'].includes(error.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    document.querySelector('#loginError').textContent = error.message;
  }
}

document.querySelector('#googleLogin').addEventListener('click', googleLogin);
document.querySelector('#logoutBtn').addEventListener('click', () => signOut(auth));
document.querySelector('#clientSearch').addEventListener('input', renderClients);

onAuthStateChanged(auth, user => {
  stopListeners();
  if (!user) {
    document.querySelector('#loginView').classList.remove('hidden');
    document.querySelector('#appView').classList.add('hidden');
    return;
  }
  document.querySelector('#loginView').classList.add('hidden');
  document.querySelector('#appView').classList.remove('hidden');
  document.querySelector('#userLabel').textContent = user.email || user.displayName || 'Admin';
  listen(user);
});
