-- Open Wi-Fi Cloudflare v1.0 - Fase 2B
-- Janelas temporárias de internet: 30 s, 3 tentativas e cooldown de 10 min.

CREATE TABLE IF NOT EXISTS attempt_limits (
  site_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  attempts_used INTEGER NOT NULL DEFAULT 0
    CHECK (attempts_used >= 0),
  cooldown_until INTEGER,
  last_attempt_started_at INTEGER,
  last_request_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(site_id, device_id),
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_attempts (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  attempt_number INTEGER NOT NULL
    CHECK (attempt_number >= 1),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','converted','cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempts_site_active_end
  ON access_attempts(site_id, status, ends_at);

CREATE INDEX IF NOT EXISTS idx_attempts_payment
  ON access_attempts(payment_id, status, ends_at);

CREATE INDEX IF NOT EXISTS idx_attempts_device
  ON access_attempts(site_id, device_id, status, ends_at);

-- Só pode existir uma janela marcada como active por aparelho.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_one_active_per_device
  ON access_attempts(site_id, device_id)
  WHERE status = 'active';

PRAGMA optimize;
