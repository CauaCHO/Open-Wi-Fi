import crypto from 'node:crypto';

const API = 'https://api.mercadopago.com';

function token() {
  const value = process.env.MP_ACCESS_TOKEN?.trim();
  if (!value) throw new Error('MP_ACCESS_TOKEN não configurado');
  return value;
}

function providerMessage(payload) {
  const parts = [
    payload?.message,
    payload?.error,
    payload?.cause?.[0]?.description,
    payload?.cause?.[0]?.code
  ].filter(Boolean);
  return [...new Set(parts.map(String))].join(' • ');
}

async function request(path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token()}`
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }

  if (!response.ok) {
    const detail = providerMessage(payload);
    const error = new Error(`Mercado Pago respondeu HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function createPixOrder({ amount, email, externalReference }) {
  const env = (process.env.MP_ENV || 'production').toLowerCase();
  const sandbox = env === 'sandbox';
  const value = sandbox ? '50.00' : Number(amount).toFixed(2);

  if (sandbox && !String(email).toLowerCase().endsWith('@testuser.com')) {
    throw Object.assign(new Error('No sandbox do Mercado Pago, use um e-mail @testuser.com'), { status: 400 });
  }

  const body = {
    type: 'online',
    total_amount: value,
    external_reference: externalReference,
    processing_mode: 'automatic',
    transactions: {
      payments: [
        {
          amount: value,
          payment_method: {
            id: 'pix',
            type: 'bank_transfer'
          },
          // O PIX permanece válido no Mercado Pago por 30 minutos.
          // Os 30 s do Open Wi-Fi controlam apenas a janela de internet temporária.
          expiration_time: 'PT30M'
        }
      ]
    },
    payer: sandbox ? { email, first_name: 'APRO' } : { email }
  };

  return request('/v1/orders', {
    method: 'POST',
    body,
    idempotencyKey: crypto.randomUUID()
  });
}

export function getOrder(orderId) {
  return request(`/v1/orders/${encodeURIComponent(orderId)}`);
}

export function cancelOrder(orderId) {
  return request(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    idempotencyKey: crypto.randomUUID()
  });
}

export function pixDataFromOrder(order) {
  const payment = order?.transactions?.payments?.[0] || {};
  const method = payment?.payment_method || {};
  return {
    paymentId: payment.id || null,
    qrCode: method.qr_code || null,
    qrCodeBase64: method.qr_code_base64 || null,
    ticketUrl: method.ticket_url || null
  };
}

export function isAccredited(order) {
  if (order?.status === 'processed' && order?.status_detail === 'accredited') return true;
  const payment = order?.transactions?.payments?.[0];
  return payment?.status === 'processed' && payment?.status_detail === 'accredited';
}

export function isCancelable(order) {
  return order?.status === 'action_required' || order?.status === 'created';
}
