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
  let polling = false;

  async function create() {
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
      if (error.blockedUntil) return goBlocked(error.blockedUntil);
      if (error.attempt) {
        active = error.attempt;
        render(active);
        startClock();
        pollStatus();
        return;
      }
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
  }

  function startClock() {
    clearInterval(timerHandle);
    const tick = async () => {
      const remaining = Math.max(0, active.uiExpiresAt - Date.now());
      const seconds = Math.ceil(remaining / 1000);
      $('timer').textContent = `00:${String(seconds).padStart(2, '0')}`;
      if (remaining <= 0) {
        clearInterval(timerHandle);
        try {
          const expired = await api(`/api/attempts/${active.id}/expire`, { method: 'POST', body: '{}' });
          handleStatus(expired);
        } catch (error) {
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
        if (status.status === 'waiting') render(status);
        if (!['waiting', 'creating'].includes(status.status)) {
          handleStatus(status);
          break;
        }
      } catch {}
    }
    polling = false;
  }

  function handleStatus(status) {
    active = status;
    if (status.status === 'approved') return finishSuccess(status);
    if (status.blockedUntil && status.blockedUntil > Date.now()) return goBlocked(status.blockedUntil);
    if (status.status === 'expired') {
      clearInterval(timerHandle);
      $('paymentStatus').textContent = 'Tentativa encerrada.';
      $('expiredBox').classList.remove('hidden');
      $('expiredText').textContent = `Você usou ${status.attemptNumber} de ${status.maxAttempts} tentativas.`;
      $('retryPayment').onclick = () => {
        $('expiredBox').classList.add('hidden');
        create();
      };
    }
  }

  function finishSuccess(status) {
    clearInterval(timerHandle);
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
