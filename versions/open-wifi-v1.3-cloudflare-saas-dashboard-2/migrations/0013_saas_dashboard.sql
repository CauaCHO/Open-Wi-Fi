-- Open Wi-Fi v1.3 - SaaS Dashboard
-- Apelidos de dispositivos e atribuicao de receita por Routerboard.

ALTER TABLE devices ADD COLUMN admin_alias TEXT;
ALTER TABLE payments ADD COLUMN router_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_site_router_approved
  ON payments(site_id,router_id,status,approved_at);

CREATE INDEX IF NOT EXISTS idx_devices_site_alias
  ON devices(site_id,admin_alias);

PRAGMA optimize;
