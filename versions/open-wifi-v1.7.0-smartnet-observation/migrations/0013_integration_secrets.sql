-- Optional Mercado Pago credentials entered by the site owner.
-- Only AES-GCM ciphertext and a random IV are stored in D1.
CREATE TABLE IF NOT EXISTS integration_secrets (
  site_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (name IN ('MP_ACCESS_TOKEN','MP_WEBHOOK_SECRET')),
  iv_b64 TEXT NOT NULL,
  ciphertext_b64 TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (site_id,name),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
