ALTER TABLE sites ADD COLUMN active_event_id TEXT;
ALTER TABLE sites ADD COLUMN background_mode TEXT NOT NULL DEFAULT 'gradient';
ALTER TABLE sites ADD COLUMN background_image_url TEXT;
ALTER TABLE sites ADD COLUMN support_whatsapp TEXT;
ALTER TABLE sites ADD COLUMN require_whatsapp_standard INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN sales_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sites ADD COLUMN portal_title TEXT NOT NULL DEFAULT 'Open Wi-Fi';
ALTER TABLE sites ADD COLUMN portal_subtitle TEXT NOT NULL DEFAULT 'Escolha seu acesso, pague via Pix e conecte.';

ALTER TABLE party_groups ADD COLUMN representative_name TEXT;
ALTER TABLE party_groups ADD COLUMN representative_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_party_groups_payment_unique
  ON party_groups(payment_id);

CREATE TABLE IF NOT EXISTS access_codes (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  code TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('standard','party')),
  event_id TEXT,
  duration_seconds INTEGER,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','consumed','expired','cancelled')),
  redeemed_device_id TEXT,
  redeemed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL,
  FOREIGN KEY(redeemed_device_id) REFERENCES devices(id) ON DELETE SET NULL,
  UNIQUE(site_id, code)
);

CREATE INDEX IF NOT EXISTS idx_access_codes_site_status_exp
  ON access_codes(site_id, status, expires_at);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_site_created
  ON admin_audit(site_id, created_at DESC);

PRAGMA optimize;
