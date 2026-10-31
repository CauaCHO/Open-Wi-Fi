// v0.9.4: WhatsApp é apenas um identificador/contato de recuperação.
// O Open Wi-Fi não abre WhatsApp, não cria links wa.me e não envia mensagens automaticamente.
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
