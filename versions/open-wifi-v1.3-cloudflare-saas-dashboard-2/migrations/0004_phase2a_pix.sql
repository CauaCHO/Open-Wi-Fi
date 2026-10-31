-- Open Wi-Fi Cloudflare v1.0 - Fase 2A
-- Campos necessários para Checkout Transparente / API Orders / Pix.

ALTER TABLE payments ADD COLUMN mp_payment_id TEXT;
ALTER TABLE payments ADD COLUMN mp_order_status TEXT;
ALTER TABLE payments ADD COLUMN mp_status_detail TEXT;
ALTER TABLE payments ADD COLUMN external_reference TEXT;
ALTER TABLE payments ADD COLUMN idempotency_key TEXT;
ALTER TABLE payments ADD COLUMN qr_code TEXT;
ALTER TABLE payments ADD COLUMN qr_code_base64 TEXT;
ALTER TABLE payments ADD COLUMN mp_expires_at INTEGER;
ALTER TABLE payments ADD COLUMN attempt_window_until INTEGER;
ALTER TABLE payments ADD COLUMN mp_last_checked_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_mp_order
  ON payments(mp_order_id)
  WHERE mp_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_external_reference
  ON payments(external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_reuse_pending
  ON payments(site_id, device_id, plan_id, status, mp_expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_access_grants_payment
  ON access_grants(payment_id);

PRAGMA optimize;
