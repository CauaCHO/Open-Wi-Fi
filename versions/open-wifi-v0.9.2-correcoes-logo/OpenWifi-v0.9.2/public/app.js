const PAGE = document.body.dataset.page;
const STORAGE = {
  device: 'ow_device_id', email: 'ow_payer_email', phone: 'ow_payer_whatsapp', choice: 'ow_choice', success: 'ow_success', resume: 'ow_device_resume'
};

function $(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatBRL(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value); }
function query(name) { return new URLSearchParams(location.search).get(name); }
function formatTime(ts) { return ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'; }
function formatDate(ts) { return ts ? new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function deviceId() {
  const mac = query('mac');
  if (mac) {
    localStorage.setItem(STORAGE.device, `MAC:${mac.toUpperCase()}`);
    return `MAC:${mac.toUpperCase()}`;
  }
  let id = localStorage.getItem(STORAGE.device);
  if (!id) { id = `BROWSER:${crypto.randomUUID()}`; localStorage.setItem(STORAGE.device, id); }
  return id;
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data = {}; try { data = await response.json(); } catch {}
  if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); Object.assign(error, data, { status: response.status }); throw error; }
  return data;
}

function goBlocked(blockedUntil) { location.href = `blocked.html?until=${encodeURIComponent(blockedUntil || Date.now() + 10 * 60_000)}`; }

async function registerSession(email = '') {
  const session = await api('/api/device/session', { method: 'POST', body: JSON.stringify({ deviceId: deviceId(), email, resumeToken: localStorage.getItem(STORAGE.resume) || '' }) });
  if (session.resumeToken) localStorage.setItem(STORAGE.resume, session.resumeToken);
  return session;
}

if (PAGE === 'home') {
  const email = $('payerEmail');
  const phone = $('payerWhatsapp');
  email.value = localStorage.getItem(STORAGE.email) || '';
  if (phone) phone.value = localStorage.getItem(STORAGE.phone) || '';
  let site = null;

  (async () => {
    try {
      const [cfg, session] = await Promise.all([api('/api/site'), registerSession(email.value.trim())]);
      site = cfg;
      renderHome(cfg);
      if (session.accessActive) {
        localStorage.setItem(STORAGE.success, JSON.stringify({ reusedAccess: true, planLabel: session.planLabel || 'Acesso já ativo', amount: null, accessUntil: session.accessUntil, networkAccess: session.networkAccess, networkError: session.networkError || null, identityId: session.identityId, linkedDevices: session.linkedDevices }));
        location.href = 'success.html';
      }
    } catch (error) {
      $('plans').innerHTML = `<div class="plans-loading">Não foi possível carregar os planos: ${escapeHtml(error.message)}</div>`;
    }
  })();

  function renderHome(cfg) {
    const party = cfg.mode === 'party';
    $('modeEyebrow').textContent = party ? 'OPEN WI-FI • PARTY MODE' : 'CONECTADO AO PORTAL';
    $('homeTitle').textContent = party ? 'Internet pra curtir a noite' : 'Escolha seu acesso';
    $('homeLead').textContent = party ? 'Escolha seu acesso ou entre no combo de um amigo. Vale Night e combos terminam junto com o evento.' : 'Selecione um plano, pague via PIX e o acesso é liberado para este dispositivo.';
    $('brandSubtitle').textContent = party ? 'Party Mode • PIX + combos' : 'Internet rápida, pagamento no PIX.';
    $('partyEventCard').classList.toggle('hidden', !party);
    $('partyJoinBox').classList.toggle('hidden', !party);
    $('whatsappBox').classList.toggle('hidden', !party);
    if (party) {
      $('partyEventName').textContent = cfg.event?.name || 'Open Wi-Fi Party';
      $('partyEventEnd').textContent = formatDate(cfg.event?.endsAt);
    }
    $('plans').innerHTML = Object.values(cfg.plans || {}).map(p => `<button class="plan ${p.featured ? 'featured' : ''}" data-plan="${escapeHtml(p.id)}" data-combo="${Number(p.comboSlots || 0)}">${p.featured ? '<span class="badge">MAIS PEDIDO</span>' : ''}<span class="plan-time">${escapeHtml(p.label)}</span><span class="plan-price">${formatBRL(p.amount)}</span><span class="plan-note">${escapeHtml(p.note || '')}</span></button>`).join('');
    document.querySelectorAll('[data-plan]').forEach(button => button.addEventListener('click', () => choosePlan(button)));
  }

  function choosePlan(button) {
    $('homeError').classList.add('hidden');
    const emailValue = email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(emailValue)) {
      $('homeError').textContent = 'Digite um e-mail válido para gerar o PIX.'; $('homeError').classList.remove('hidden'); email.focus(); return;
    }
    const phoneValue = phone?.value.trim() || '';
    if (site?.mode === 'party' && phoneValue.replace(/\D/g,'').length < 10) {
      $('homeError').textContent = 'No Party Mode, informe um WhatsApp válido antes de gerar o PIX.'; $('homeError').classList.remove('hidden'); phone?.focus(); return;
    }
    localStorage.setItem(STORAGE.email, emailValue);
    if (phoneValue) localStorage.setItem(STORAGE.phone, phoneValue);
    localStorage.setItem(STORAGE.choice, JSON.stringify({ plan: button.dataset.plan, whatsapp: phoneValue }));
    location.href = `pay.html?plan=${encodeURIComponent(button.dataset.plan)}`;
  }
}

if (PAGE === 'pay') {
  const stored = JSON.parse(localStorage.getItem(STORAGE.choice) || '{}');
  const plan = query('plan') || stored.plan;
  const email = localStorage.getItem(STORAGE.email) || '';
  const whatsapp = stored.whatsapp || localStorage.getItem(STORAGE.phone) || '';
  const dev = deviceId();
  let active = null, timerHandle = null, cooldownHandle = null, polling = false;

  async function copyCurrentPix(showHint = true) {
    const code = active?.qrCode || '';
    if (!code) throw new Error('O código PIX ainda não está disponível.');
    try { await navigator.clipboard.writeText(code); }
    catch {
      const ta=document.createElement('textarea'); ta.value=code; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    if (showHint) {
      $('bankHint')?.classList.remove('hidden');
      setTimeout(()=>$('bankHint')?.classList.add('hidden'),7000);
    }
  }


  async function create() {
    clearInterval(cooldownHandle);
    $('paymentError').classList.add('hidden'); $('loadingPayment').classList.remove('hidden'); $('paymentContent').classList.add('hidden');
    try {
      active = await api('/api/attempts', { method: 'POST', body: JSON.stringify({ deviceId: dev, plan, email, whatsapp, resumeToken: localStorage.getItem(STORAGE.resume) || '' }) });
      render(active); startClock(); pollStatus();
    } catch (error) {
      if (error.attempt) { active = error.attempt; render(active); handleStatus(active); pollStatus(); return; }
      if (error.blockedUntil) return goBlocked(error.blockedUntil);
      $('loadingPayment').classList.add('hidden'); $('paymentError').classList.remove('hidden'); $('paymentErrorText').textContent = error.message;
    }
  }

  function render(data) {
    $('loadingPayment').classList.add('hidden'); $('paymentContent').classList.remove('hidden');
    $('paymentPlan').textContent = data.planLabel; $('paymentPrice').textContent = formatBRL(data.amount); $('attemptCounter').textContent = `${data.attemptNumber} de ${data.maxAttempts}`;
    $('pixValidity').textContent = data.paymentExpiresAt ? `O PIX continua válido até aproximadamente ${formatTime(data.paymentExpiresAt)}.` : 'O PIX continua válido conforme o vencimento da cobrança.';
    $('sandboxNotice')?.classList.toggle('hidden', data.paymentsEnvironment !== 'sandbox');
    const qr = $('qrImage'), mock = $('mockQr'); qr.classList.add('hidden'); mock.classList.add('hidden');
    if (data.qrCodeBase64) { qr.src = `data:image/png;base64,${data.qrCodeBase64}`; qr.classList.remove('hidden'); }
    else if (data.paymentsMode === 'mock') mock.classList.remove('hidden');
    else { mock.innerHTML = '<strong>Preparando QR PIX…</strong><span>O Mercado Pago ainda está processando a cobrança.</span>'; mock.classList.remove('hidden'); }
    $('copyPix').onclick = async () => { try { await copyCurrentPix(true); const old=$('copyPix').textContent; $('copyPix').textContent='PIX copiado ✓'; setTimeout(()=>$('copyPix').textContent=old,1200); } catch { alert(data.qrCode || 'Código PIX indisponível.'); } };
    if (data.paymentsMode === 'mock') { $('simulatePaid').classList.remove('hidden'); $('simulatePaid').onclick=async()=>finishSuccess(await api(`/api/dev/attempts/${data.id}/approve`,{method:'POST',body:'{}'})); } else $('simulatePaid').classList.add('hidden');
    if (data.status === 'waiting' && data.windowExpired) showWindowClosed(data); else if (data.status === 'waiting') hideWindowClosed();
  }

  function startClock() {
    clearInterval(timerHandle);
    if (!active || active.status !== 'waiting' || active.windowExpired || active.uiExpiresAt <= Date.now()) { if (active) handleStatus(active); return; }
    const tick = async () => {
      const remaining=Math.max(0,active.uiExpiresAt-Date.now()), seconds=Math.ceil(remaining/1000); $('timer').textContent=`00:${String(seconds).padStart(2,'0')}`; $('timer').classList.toggle('danger',seconds<=5);
      if (remaining<=0) { clearInterval(timerHandle); try { active=await api(`/api/attempts/${active.id}/expire`,{method:'POST',body:'{}'}); handleStatus(active); } catch { $('paymentStatus').textContent='Confirmando o estado da cobrança...'; } }
    }; tick(); timerHandle=setInterval(tick,250);
  }

  async function pollStatus() {
    if (polling) return; polling=true;
    while (active && ['waiting','creating'].includes(active.status)) { await sleep(1800); try { const status=await api(`/api/attempts/${active.id}`); active=status; render(status); if(status.status==='approved'){finishSuccess(status);break;} if(!['waiting','creating'].includes(status.status)){handleStatus(status);break;} } catch {} }
    polling=false;
  }

  function hideWindowClosed(){clearInterval(cooldownHandle);$('expiredBox').classList.add('hidden');$('paymentStatus').textContent='Aguardando pagamento...';}
  function showWindowClosed(status){
    clearInterval(timerHandle);$('timer').textContent='00:00';$('timer').classList.add('danger');$('paymentStatus').textContent='Janela temporária encerrada. O PIX continua aguardando pagamento.';$('expiredBox').classList.remove('hidden');$('expiredTitle').textContent='Os 30 segundos de internet temporária terminaram.';
    const button=$('retryPayment'), text=$('expiredText');
    const update=()=>{const blockedMs=Math.max(0,(status.blockedUntil||0)-Date.now());if(blockedMs>0){const total=Math.ceil(blockedMs/1000),m=Math.floor(total/60),s=total%60;text.textContent=`O QR PIX continua válido. Nova janela disponível em ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.`;button.disabled=true;button.textContent=`Aguardar ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}else{clearInterval(cooldownHandle);text.textContent=`O QR PIX continua válido. Você usou ${status.attemptNumber} de ${status.maxAttempts} janelas.`;button.disabled=false;button.textContent='Abrir nova janela de 30 s';}};
    button.onclick=()=>create();update();if(status.blockedUntil>Date.now())cooldownHandle=setInterval(update,250);
  }
  function handleStatus(status){active=status;if(status.status==='approved')return finishSuccess(status);if(status.status==='payment_expired'){clearInterval(timerHandle);clearInterval(cooldownHandle);$('paymentStatus').textContent='Este PIX venceu no Mercado Pago.';$('expiredBox').classList.remove('hidden');$('expiredTitle').textContent='O PIX expirou.';$('expiredText').textContent='Gere uma nova cobrança para continuar.';$('retryPayment').disabled=false;$('retryPayment').textContent='Gerar novo PIX';$('retryPayment').onclick=()=>create();return;}if(status.status==='waiting'&&status.windowExpired)return showWindowClosed(status);if(status.status==='waiting'){hideWindowClosed();startClock();}}
  function renderApproved(status){
    $('loadingPayment').classList.add('hidden');
    $('paymentContent').classList.add('hidden');
    $('paymentError').classList.add('hidden');
    $('paymentApproved').classList.remove('hidden');
    $('approvedPlan').textContent = `${status.planLabel || 'Acesso'}${status.amount != null ? ` • ${formatBRL(status.amount)}` : ''}`;
    $('approvedValidity').textContent = formatDate(status.accessUntil);
    const note=$('approvedRouterNote');
    const updateNetwork=s=>{if(s.networkAccess==='active')note.textContent='Dispositivo liberado automaticamente na MikroTik ✓';else if(s.networkAccess==='mock')note.textContent='Modo MikroTik mock: pagamento aprovado sem alterar a RB.';else if(s.networkAccess==='sync_error')note.textContent=`Pagamento aprovado. A RB ainda não sincronizou: ${s.networkError||'tentando novamente...'}`;else note.textContent='Pagamento aprovado. Sincronizando o acesso com a MikroTik...';};
    const renderCombo=s=>{const c=s.combo;if(!c)return;$('approvedCombo').classList.remove('hidden');$('approvedComboCode').textContent=c.code;$('approvedComboUsed').textContent=c.usedDevices;$('approvedComboMax').textContent=c.maxDevices;$('approvedCopyCombo').onclick=async()=>{try{await navigator.clipboard.writeText(c.code);$('approvedCopyCombo').textContent='Código copiado ✓';}catch{alert(c.code);}};if(c.whatsappShareUrl){$('approvedShareWhatsapp').href=c.whatsappShareUrl;$('approvedShareWhatsapp').classList.remove('hidden');}else $('approvedShareWhatsapp').classList.add('hidden');$('approvedWhatsappNote').textContent=c.whatsappStatus==='sent'?'Código enviado automaticamente pelo WhatsApp ✓':'O código fica salvo no servidor. Use o botão acima para enviar ou reenvie pelo painel.';};
    updateNetwork(status);renderCombo(status);
    if(status.id && (!['active','mock'].includes(status.networkAccess) || (!status.combo && ['duo','quartet'].includes(status.plan)))){
      const syncTimer=setInterval(async()=>{try{const refreshed=await api(`/api/attempts/${status.id}`);localStorage.setItem(STORAGE.success,JSON.stringify(refreshed));updateNetwork(refreshed);renderCombo(refreshed);if(['active','mock'].includes(refreshed.networkAccess)&&(!['duo','quartet'].includes(refreshed.plan)||refreshed.combo))clearInterval(syncTimer);}catch{}},2000);
    }
  }
  function finishSuccess(status){clearInterval(timerHandle);clearInterval(cooldownHandle);active=status;localStorage.setItem(STORAGE.success,JSON.stringify(status));renderApproved(status);}
  if(!plan||!email)location.href='index.html';else create();
}

if (PAGE === 'blocked') {
  const until=Number(query('until'))||Date.now()+10*60_000;const tick=()=>{const ms=Math.max(0,until-Date.now()),total=Math.ceil(ms/1000),m=Math.floor(total/60),s=total%60;$('blockTimer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;if(ms<=0)location.href='index.html';};tick();setInterval(tick,250);
}

if (PAGE === 'success') {
  let data=JSON.parse(localStorage.getItem(STORAGE.success)||'null');
  if(!data)location.href='index.html';else{
    if(data.reusedAccess){$('successEyebrow').textContent='ACESSO RECONHECIDO';$('successTitle').textContent='Seu acesso continua ativo!';$('successLead').textContent=data.linkedDevices>1?`Reconhecemos este aparelho e vinculamos ${data.linkedDevices} endereços de rede ao mesmo acesso.`:'Reconhecemos este aparelho pelo Device ID do Open Wi‑Fi e reaplicamos a liberação.';}
    $('successPlan').textContent=data.reusedAccess||data.amount==null?(data.planLabel||'Acesso já ativo'):`${data.planLabel} • ${formatBRL(data.amount)}`;$('successValidity').textContent=formatDate(data.accessUntil);
    const note=$('routerNote');const updateNetworkNote=status=>{if(status.networkAccess==='active')note.textContent='Dispositivo liberado automaticamente na MikroTik ✓';else if(status.networkAccess==='mock')note.textContent='Modo MikroTik mock: pagamento aprovado sem alterar a RB.';else if(status.networkAccess==='sync_error')note.textContent=`Pagamento aprovado. A RB ainda não sincronizou: ${status.networkError||'tentando novamente...'}`;else note.textContent='Pagamento aprovado. Sincronizando o acesso com a MikroTik...';};updateNetworkNote(data);
    const renderCombo=status=>{const c=status.combo;if(!c)return;$('comboSuccess').classList.remove('hidden');$('comboCode').textContent=c.code;$('comboUsed').textContent=c.usedDevices;$('comboMax').textContent=c.maxDevices;$('copyCombo').onclick=async()=>{try{await navigator.clipboard.writeText(c.code);$('copyCombo').textContent='Código copiado ✓';}catch{alert(c.code);}};if(c.whatsappShareUrl){$('shareWhatsapp').href=c.whatsappShareUrl;$('shareWhatsapp').classList.remove('hidden');}else $('shareWhatsapp').classList.add('hidden');$('whatsappNote').textContent=c.whatsappStatus==='sent'?'Convite enviado automaticamente pelo WhatsApp ✓':'O convite fica salvo no servidor. Use o botão acima para enviar ou reenvie pelo painel.';};renderCombo(data);
    if(data.id&&!['active','mock'].includes(data.networkAccess)|| (data.id && !data.combo && ['duo','quartet'].includes(data.plan))){const syncTimer=setInterval(async()=>{try{const status=await api(`/api/attempts/${data.id}`);data=status;updateNetworkNote(status);renderCombo(status);localStorage.setItem(STORAGE.success,JSON.stringify(status));if(['active','mock'].includes(status.networkAccess)&&(!['duo','quartet'].includes(status.plan)||status.combo))clearInterval(syncTimer);}catch{}},2000);}
    $('continueInternet').onclick=()=>location.href='http://neverssl.com/';
  }
}

if (PAGE === 'join') {
  const input=$('inviteCode'); let activeInvite=query('invite')||''; let combo=null;
  input.addEventListener('input',()=>{let raw=input.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);input.value=raw.length>4?`${raw.slice(0,4)}-${raw.slice(4)}`:raw;});
  async function lookup(){try{$('inviteError').classList.add('hidden');combo=await api('/api/party/lookup',{method:'POST',body:JSON.stringify({code:input.value,invite:activeInvite})});$('inviteCard').classList.remove('hidden');$('inviteLabel').textContent=combo.label;$('inviteCodeView').textContent=combo.code;$('inviteEvent').textContent=combo.eventName||'Open Wi-Fi Party';$('inviteSlots').textContent=`${combo.usedDevices}/${combo.maxDevices}`;$('inviteUntil').textContent=formatDate(combo.expiresAt);input.value=combo.code;}catch(e){combo=null;$('inviteCard').classList.add('hidden');$('inviteError').classList.remove('hidden');$('inviteErrorText').textContent=e.message;}}
  $('lookupInvite').onclick=lookup;
  $('joinCombo').onclick=async()=>{try{const joined=await api('/api/party/join',{method:'POST',body:JSON.stringify({code:input.value,invite:activeInvite,deviceId:deviceId(),resumeToken:localStorage.getItem(STORAGE.resume)||''})});if(joined.resumeToken)localStorage.setItem(STORAGE.resume,joined.resumeToken);$('inviteCard').classList.add('hidden');$('joinSuccess').classList.remove('hidden');$('joinSuccessText').textContent=`${joined.label}: ${joined.usedDevices}/${joined.maxDevices} aparelhos. Acesso até ${formatDate(joined.accessUntil)}.`;}catch(e){$('inviteError').classList.remove('hidden');$('inviteErrorText').textContent=e.message;}};
  $('joinContinue').onclick=()=>location.href='http://neverssl.com/';
  const codeFromUrl=query('code'); if(codeFromUrl){input.value=codeFromUrl;lookup();} else if(activeInvite)lookup();
}
