-- Open Wi-Fi Cloudflare v1.0 - Fase 3A.1
-- Suspensão administrativa individual e em massa.

ALTER TABLE devices ADD COLUMN admin_blocked INTEGER NOT NULL DEFAULT 0
  CHECK (admin_blocked IN (0,1));

ALTER TABLE devices ADD COLUMN admin_block_reason TEXT;
ALTER TABLE devices ADD COLUMN admin_blocked_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_devices_site_admin_blocked
  ON devices(site_id, admin_blocked, updated_at);

PRAGMA optimize;
