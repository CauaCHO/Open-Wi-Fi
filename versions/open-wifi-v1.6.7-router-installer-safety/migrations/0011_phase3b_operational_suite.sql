-- Open Wi-Fi v1.1 - Fase 3B
-- Operação completa: mídia R2, velocidade, cortesia, relatórios,
-- avisos, privacidade/LGPD, equipe, diagnóstico e reconciliação.

ALTER TABLE sites ADD COLUMN notice_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (notice_enabled IN (0,1));
ALTER TABLE sites ADD COLUMN notice_title TEXT;
ALTER TABLE sites ADD COLUMN notice_text TEXT;
ALTER TABLE sites ADD COLUMN notice_starts_at INTEGER;
ALTER TABLE sites ADD COLUMN notice_ends_at INTEGER;
ALTER TABLE sites ADD COLUMN emergency_message TEXT NOT NULL DEFAULT
  'Novas vendas estão temporariamente pausadas. Acessos já liberados continuam funcionando.';
ALTER TABLE sites ADD COLUMN privacy_title TEXT NOT NULL DEFAULT
  'Privacidade e uso de dados';
ALTER TABLE sites ADD COLUMN privacy_text TEXT NOT NULL DEFAULT
  'Para operar o acesso à rede, o Open Wi-Fi pode utilizar identificadores técnicos do aparelho, como MAC e Device ID, além de e-mail e WhatsApp informados no portal. Informações de pagamento são processadas pelo provedor de pagamento.';
ALTER TABLE sites ADD COLUMN privacy_require_accept INTEGER NOT NULL DEFAULT 0
  CHECK (privacy_require_accept IN (0,1));
ALTER TABLE sites ADD COLUMN privacy_policy_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sites ADD COLUMN last_mp_webhook_at INTEGER;
ALTER TABLE sites ADD COLUMN last_mp_webhook_order_id TEXT;
ALTER TABLE sites ADD COLUMN last_reconcile_at INTEGER;

ALTER TABLE plans ADD COLUMN rate_limit_down_kbps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN rate_limit_up_kbps INTEGER NOT NULL DEFAULT 0;

ALTER TABLE access_grants ADD COLUMN grant_source TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE access_grants ADD COLUMN grant_label TEXT;
ALTER TABLE access_grants ADD COLUMN rate_limit_down_kbps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE access_grants ADD COLUMN rate_limit_up_kbps INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS portal_visits (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  visit_bucket INTEGER NOT NULL,
  visited_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE(site_id, device_id, visit_bucket)
);

CREATE INDEX IF NOT EXISTS idx_portal_visits_site_time
  ON portal_visits(site_id, visited_at, device_id);

CREATE TABLE IF NOT EXISTS privacy_acceptances (
  site_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY(site_id, device_id, policy_version),
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE(site_id, username)
);

CREATE INDEX IF NOT EXISTS idx_admin_accounts_site_role
  ON admin_accounts(site_id, role, enabled);

CREATE INDEX IF NOT EXISTS idx_grants_site_source
  ON access_grants(site_id, grant_source, status, ends_at);

PRAGMA optimize;
