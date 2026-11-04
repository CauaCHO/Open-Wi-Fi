-- Per-account router visibility and a safe per-client speed ceiling.
ALTER TABLE admin_accounts ADD COLUMN router_scope_mode TEXT NOT NULL DEFAULT 'all'
  CHECK (router_scope_mode IN ('all','selected'));

CREATE TABLE IF NOT EXISTS admin_router_permissions (
  account_id TEXT NOT NULL,
  router_id TEXT NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 1 CHECK (can_view IN (0,1)),
  can_edit INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0,1)),
  PRIMARY KEY (account_id,router_id),
  FOREIGN KEY (account_id) REFERENCES admin_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (router_id) REFERENCES router_devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_router_permissions_router
  ON admin_router_permissions(router_id,account_id);

ALTER TABLE router_devices ADD COLUMN max_client_down_kbps INTEGER NOT NULL DEFAULT 0
  CHECK (max_client_down_kbps BETWEEN 0 AND 1000000);
ALTER TABLE router_devices ADD COLUMN max_client_up_kbps INTEGER NOT NULL DEFAULT 0
  CHECK (max_client_up_kbps BETWEEN 0 AND 1000000);
