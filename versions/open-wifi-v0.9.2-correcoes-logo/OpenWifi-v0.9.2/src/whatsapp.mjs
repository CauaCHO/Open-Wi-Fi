function mode() { return (process.env.WHATSAPP_MODE || 'link').toLowerCase(); }
function graphVersion() { return process.env.WHATSAPP_GRAPH_VERSION || 'v26.0'; }

export function normalizeWhatsApp(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!/^\d{12,15}$/.test(digits)) return '';
  return digits;
}

export function maskWhatsApp(value) {
  const d = normalizeWhatsApp(value);
  if (!d) return '-';
  const local = d.startsWith('55') ? d.slice(2) : d;
  return local.length >= 8 ? `(${local.slice(0,2)}) 9••••-${local.slice(-4)}` : `••••${local.slice(-4)}`;
}

export function comboMessage({ combo, event }) {
  const eventName = event?.name || 'Open Wi-Fi Party';
  const expires = combo.expiresAt ? new Date(combo.expiresAt).toLocaleString('pt-BR', { timeZone: process.env.ADMIN_TIMEZONE || 'America/Sao_Paulo' }) : 'fim do evento';
  return `🎉 Seu código Open Wi-Fi está pronto!\n\nEvento: ${eventName}\nCódigo: ${combo.code}\nVagas: ${combo.maxDevices}\nVálido até: ${expires}\n\nPara entrar, conecte no Open Wi-Fi, escolha “Entrar em um combo” e digite o código ${combo.code}.`;
}

export function whatsappShareUrl(phone, text) {
  const to = normalizeWhatsApp(phone);
  return to ? `https://wa.me/${to}?text=${encodeURIComponent(text)}` : '';
}

async function metaFetch(url, options = {}) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN não configurado');
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.error?.message || `WhatsApp HTTP ${response.status}`);
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function sendTemplate({ to, combo, event }) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME?.trim() || 'openwifi_party_invite';
  const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'pt_BR';
  const expires = combo.expiresAt ? new Date(combo.expiresAt).toLocaleString('pt-BR', { timeZone: process.env.ADMIN_TIMEZONE || 'America/Sao_Paulo' }) : 'fim do evento';
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: [
        { type: 'body', parameters: [
          { type: 'text', text: combo.code },
          { type: 'text', text: event?.name || 'Open Wi-Fi Party' },
          { type: 'text', text: expires }
        ] }
      ]
    }
  };
  return metaFetch(`https://graph.facebook.com/${graphVersion()}/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export class WhatsAppService {
  mode() { return mode(); }

  async sendComboInvite({ combo, event }) {
    const text = comboMessage({ combo, event });
    const shareUrl = whatsappShareUrl(combo.whatsapp, text);
    if (mode() !== 'cloud-template') return { mode: mode(), automatic: false, shareUrl, status: 'ready_to_share' };

    const to = normalizeWhatsApp(combo.whatsapp);
    if (!to) return { mode: mode(), automatic: false, shareUrl, status: 'invalid_number' };
    try {
      const sent = await sendTemplate({ to, combo, event });
      return { mode: mode(), automatic: true, shareUrl, status: 'sent', messageId: sent?.messages?.[0]?.id || null };
    } catch (error) {
      console.error('[whatsapp]', error.message, error.payload || '');
      return { mode: mode(), automatic: false, shareUrl, status: 'send_failed', error: error.message };
    }
  }
}
