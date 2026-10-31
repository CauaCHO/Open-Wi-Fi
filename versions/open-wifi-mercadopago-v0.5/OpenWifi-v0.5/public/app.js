const PAGE = document.body.dataset.page;
const STORAGE = {
  device: 'ow_device_id',
  email: 'ow_payer_email',
  choice: 'ow_choice',
  success: 'ow_success'
};

function $(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatBRL(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value); }
function query(name) { return new URLSearchParams(location.search).get(name); }
function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function deviceId() {
  // Durante o desenvolvimento, aceita ?mac=AA:BB:... para simular o valor que a MikroTik fornecerá.
  // Em produção esse identificador NÃO deve ser confiado diretamente ao navegador.
  const mac = query('mac');
  if (mac) {
    localStorage.setItem(STORAGE.device, `MAC:${mac.toUpperCase()}`);
    return `MAC:${mac.toUpperCase()}`;
  }
  let id = localStorage.getItem(STORAGE.device);
  if (!id) {
    id = `BROWSER:${crypto.randomUUID()}`;
    localStorage.setItem(STORAGE.device, id);
  }
  return id;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    Object.assign(error, data, { status: response.status });
    throw error;
  }
  return data;
}

function goBlocked(blockedUntil) {
  location.href = `blocked.html?until=${encodeURIComponent(blockedUntil || Date.now() + 10 * 60_000)}`;
}

if (PAGE === 'home') {
  const email = $('payerEmail');
  email.value = localStorage.getItem(STORAGE.email) || '';
  deviceId();

  document.querySelectorAll('[data-plan]').forEach(button => {
    button.addEventListener('click', () => {
      const value = email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(value)) {
        $('homeError').textContent = 'Digite um e-mail válido para gerar o PIX.';
        $('homeError').classList.remove('hidden');
        email.focus();
        return;
      }
      localStorage.setItem(STORAGE.email, value);
      localStorage.setItem(STORAGE.choice, JSON.stringify({ plan: button.dataset.plan }));
      location.href = `pay.html?plan=${encodeURIComponent(button.dataset.plan)}`;
    });
  });
}

if (PAGE === 'pay') {
  const plan = query('plan') || JSON.parse(localStorage.getItem(STORAGE.choice) || '{}').plan;
  const email = localStorage.getItem(STORAGE.email) || '';
  const dev = deviceId();
  let active = null;
  let timerHandle = null;
  let cooldownHandle = null;
  let polling = false;

  async function create() {
    clearInterval(cooldownHandle);
    $('paymentError').classList.add('hidden');
    $('loadingPayment').classList.remove('hidden');
    $('paymentContent').classList.add('hidden');
    try {
      active = await api('/api/attempts', {
        method: 'POST',
        body: JSON.stringify({ deviceId: dev, plan, email })
      });
      render(active);
      startClock();
      pollStatus();
    } catch (error) {
      // Se já existe um QR válido, mostramos esse QR mesmo durante o cooldown.
      if (error.attempt) {
        active = error.attempt;
        render(active);
        handleStatus(active);
        pollStatus();
        return;
      }
      if (error.blockedUntil) return goBlocked(error.blockedUntil);
      $('loadingPayment').classList.add('hidden');
      $('paymentError').classList.remove('hidden');
      $('paymentErrorText').textContent = error.message;
    }
  }

  function render(data) {
    $('loadingPayment').classList.add('hidden');
    $('paymentContent').classList.remove('hidden');
    $('paymentPlan').textContent = data.planLabel;
    $('paymentPrice').textContent = formatBRL(data.amount);
    $('attemptCounter').textContent = `${data.attemptNumber} de ${data.maxAttempts}`;
    $('pixValidity').textContent = data.paymentExpiresAt
      ? `O PIX continua válido até aproximadamente ${formatTime(data.paymentExpiresAt)}.`
      : 'O PIX continua válido conforme o vencimento da cobrança.';

    const sandboxNotice = $('sandboxNotice');
    if (sandboxNotice) {
      if (data.paymentsEnvironment === 'sandbox') sandboxNotice.classList.remove('hidden');
      else sandboxNotice.classList.add('hidden');
    }

    const qr = $('qrImage');
    const mock = $('mockQr');
    qr.classList.add('hidden');
    mock.classList.add('hidden');
    if (data.qrCodeBase64) {
      qr.src = `data:image/png;base64,${data.qrCodeBase64}`;
      qr.classList.remove('hidden');
    } else if (data.paymentsMode === 'mock') {
      mock.classList.remove('hidden');
    } else {
      mock.innerHTML = '<strong>Preparando QR PIX…</strong><span>O Mercado Pago ainda está processando a cobrança.</span>';
      mock.classList.remove('hidden');
    }

    $('copyPix').onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.qrCode || '');
        const old = $('copyPix').textContent;
        $('copyPix').textContent = 'PIX copiado ✓';
        setTimeout(() => $('copyPix').textContent = old, 1200);
      } catch {
        alert(data.qrCode || 'Código PIX indisponível.');
      }
    };

    if (data.ticketUrl) {
      $('ticketUrl').href = data.ticketUrl;
      $('ticketUrl').classList.remove('hidden');
    } else $('ticketUrl').classList.add('hidden');

    if (data.paymentsMode === 'mock') {
      $('simulatePaid').classList.remove('hidden');
      $('simulatePaid').onclick = async () => {
        const approved = await api(`/api/dev/attempts/${data.id}/approve`, { method: 'POST', body: '{}' });
        finishSuccess(approved);
      };
    } else $('simulatePaid').classList.add('hidden');

    if (data.status === 'waiting' && data.windowExpired) showWindowClosed(data);
    else if (data.status === 'waiting') hideWindowClosed();
  }

  function startClock() {
    clearInterval(timerHandle);
    if (!active || active.status !== 'waiting' || active.windowExpired || active.uiExpiresAt <= Date.now()) {
      if (active) handleStatus(active);
      return;
    }

    const tick = async () => {
      const remaining = Math.max(0, active.uiExpiresAt - Date.now());
      const seconds = Math.ceil(remaining / 1000);
      $('timer').textContent = `00:${String(seconds).padStart(2, '0')}`;
      $('timer').classList.toggle('danger', seconds <= 5);
      if (remaining <= 0) {
        clearInterval(timerHandle);
        try {
          const closed = await api(`/api/attempts/${active.id}/expire`, { method: 'POST', body: '{}' });
          active = closed;
          handleStatus(closed);
        } catch {
          $('paymentStatus').textContent = 'Confirmando o estado da cobrança...';
        }
      }
    };
    tick();
    timerHandle = setInterval(tick, 250);
  }

  async function pollStatus() {
    if (polling) return;
    polling = true;
    while (active && ['waiting', 'creating'].includes(active.status)) {
      await sleep(1800);
      try {
        const status = await api(`/api/attempts/${active.id}`);
        active = status;
        render(status);
        if (status.status === 'approved') {
          finishSuccess(status);
          break;
        }
        if (!['waiting', 'creating'].includes(status.status)) {
          handleStatus(status);
          break;
        }
      } catch {}
    }
    polling = false;
  }

  function hideWindowClosed() {
    clearInterval(cooldownHandle);
    $('expiredBox').classList.add('hidden');
    $('paymentStatus').textContent = 'Aguardando pagamento...';
  }

  function showWindowClosed(status) {
    clearInterval(timerHandle);
    $('timer').textContent = '00:00';
    $('timer').classList.add('danger');
    $('paymentStatus').textContent = 'Janela temporária encerrada. O PIX continua aguardando pagamento.';
    $('expiredBox').classList.remove('hidden');
    $('expiredTitle').textContent = 'Os 30 segundos de internet temporária terminaram.';

    const button = $('retryPayment');
    const text = $('expiredText');

    const update = () => {
      const blockedMs = Math.max(0, (status.blockedUntil || 0) - Date.now());
      if (blockedMs > 0) {
        const total = Math.ceil(blockedMs / 1000);
        const m = Math.floor(total / 60);
        const s = total % 60;
        text.textContent = `O QR PIX continua válido e pode ser pago normalmente. Você usou ${status.attemptNumber} de ${status.maxAttempts} janelas. Nova janela disponível em ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.`;
        button.disabled = true;
        button.textContent = `Aguardar ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      } else {
        clearInterval(cooldownHandle);
        const exhausted = status.attemptNumber >= status.maxAttempts;
        text.textContent = exhausted
          ? 'O QR PIX continua válido. O cooldown terminou; você já pode abrir uma nova janela de 30 segundos usando esta mesma cobrança.'
          : `O QR PIX continua válido. Você usou ${status.attemptNumber} de ${status.maxAttempts} janelas de pagamento.`;
        button.disabled = false;
        button.textContent = 'Abrir nova janela de 30 s';
      }
    };

    button.onclick = () => create();
    update();
    if (status.blockedUntil > Date.now()) cooldownHandle = setInterval(update, 250);
  }

  function handleStatus(status) {
    active = status;
    if (status.status === 'approved') return finishSuccess(status);

    if (status.status === 'payment_expired') {
      clearInterval(timerHandle);
      clearInterval(cooldownHandle);
      $('paymentStatus').textContent = 'Este PIX venceu no Mercado Pago.';
      $('expiredBox').classList.remove('hidden');
      $('expiredTitle').textContent = 'O PIX expirou.';
      $('expiredText').textContent = 'Gere uma nova cobrança para continuar.';
      $('retryPayment').disabled = false;
      $('retryPayment').textContent = 'Gerar novo PIX';
      $('retryPayment').onclick = () => create();
      return;
    }

    if (status.status === 'waiting' && status.windowExpired) {
      showWindowClosed(status);
      return;
    }

    if (status.status === 'waiting') {
      hideWindowClosed();
      startClock();
    }
  }

  function finishSuccess(status) {
    clearInterval(timerHandle);
    clearInterval(cooldownHandle);
    localStorage.setItem(STORAGE.success, JSON.stringify(status));
    location.href = 'success.html';
  }

  if (!plan || !email) location.href = 'index.html';
  else create();
}

if (PAGE === 'blocked') {
  const until = Number(query('until')) || Date.now() + 10 * 60_000;
  const tick = () => {
    const ms = Math.max(0, until - Date.now());
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    $('blockTimer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (ms <= 0) location.href = 'index.html';
  };
  tick();
  setInterval(tick, 250);
}

if (PAGE === 'success') {
  const data = JSON.parse(localStorage.getItem(STORAGE.success) || 'null');
  if (!data) location.href = 'index.html';
  else {
    $('successPlan').textContent = `${data.planLabel} • ${formatBRL(data.amount)}`;
    $('successValidity').textContent = data.accessUntil ? new Date(data.accessUntil).toLocaleString('pt-BR') : '—';
    $('continueInternet').addEventListener('click', () => {
      location.href = 'http://neverssl.com/';
    });
  }
}
