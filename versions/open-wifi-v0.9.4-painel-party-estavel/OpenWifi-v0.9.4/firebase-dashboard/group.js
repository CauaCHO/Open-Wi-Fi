import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const params = new URLSearchParams(location.search);
const token = String(params.get('g') || '').trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtDate = ts => ts ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(Number(ts))) : '—';

function fail(message) {
  document.querySelector('#groupLoading').classList.add('hidden');
  document.querySelector('#groupContent').classList.add('hidden');
  document.querySelector('#groupError').classList.remove('hidden');
  document.querySelector('#groupErrorText').textContent = message;
}

function render(data) {
  document.querySelector('#groupLoading').classList.add('hidden');
  document.querySelector('#groupError').classList.add('hidden');
  document.querySelector('#groupContent').classList.remove('hidden');
  document.querySelector('#groupLabel').textContent = data.label || 'Grupo Party';
  document.querySelector('#groupEvent').textContent = `${data.eventName || 'Open Wi-Fi Party'} • válido até ${fmtDate(data.expiresAt)}`;
  document.querySelector('#groupCode').textContent = data.code || '—';
  document.querySelector('#groupUsed').textContent = Number(data.usedDevices || 0);
  document.querySelector('#groupMax').textContent = Number(data.maxDevices || 0);
  const status = document.querySelector('#groupStatus');
  const active = data.status === 'active' && Number(data.expiresAt || 0) > Date.now();
  status.textContent = active ? 'Grupo ativo' : 'Grupo encerrado';
  status.className = `status-chip ${active ? 'online' : 'offline'}`;
  document.querySelector('#groupUpdated').textContent = data.syncedAt ? `Atualizado ${fmtDate(data.syncedAt)}` : '';
  const members = Array.isArray(data.members) ? data.members : [];
  const rows = [];
  for (let i = 0; i < Number(data.maxDevices || 0); i++) {
    const m = members[i];
    if (m) {
      rows.push(`<article class="group-member filled"><div class="member-index">${i+1}</div><div class="member-info"><strong>${esc(m.name || `Aparelho ${i+1}`)}</strong><span>${m.role === 'owner' ? 'Comprador do grupo' : 'Participante'} • entrou ${fmtDate(m.joinedAt)}</span>${m.macTail ? `<small>MAC final ••:${esc(m.macTail)}${Number(m.macCount||1)>1 ? ` • ${Number(m.macCount)} MACs vinculados` : ''}</small>` : ''}</div><span class="pill ${m.online ? 'good' : ''}">${m.online ? 'Online agora' : 'Vaga ocupada'}</span></article>`);
    } else {
      rows.push(`<article class="group-member empty-slot"><div class="member-index">${i+1}</div><div class="member-info"><strong>Vaga disponível</strong><span>Aguardando um aparelho entrar com o código.</span></div><span class="pill">Livre</span></article>`);
    }
  }
  document.querySelector('#groupMembers').innerHTML = rows.join('');
}

if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) {
  fail('O endereço de acompanhamento está incompleto ou inválido.');
} else {
  onSnapshot(doc(db, 'openwifi_group_public', token), snap => {
    if (!snap.exists()) return fail('O grupo ainda não foi sincronizado ou este link não existe. Tente novamente em alguns segundos.');
    render(snap.data());
  }, error => fail(error.message || 'Falha ao consultar o grupo.'));
}
