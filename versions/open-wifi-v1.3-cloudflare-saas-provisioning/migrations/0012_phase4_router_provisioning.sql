-- Open Wi-Fi v1.2 - Fase 4
-- Auto-provisionamento / adoção de MikroTik.

CREATE TABLE IF NOT EXISTS router_devices (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  install_mode TEXT NOT NULL DEFAULT 'agent'
    CHECK (install_mode IN ('full','hotspot','agent')),
  install_status TEXT NOT NULL DEFAULT 'enrolled',
  install_step TEXT,
  install_message TEXT,
  wan_interface TEXT,
  lan_ports_json TEXT,
  network_cidr TEXT,
  gateway_ip TEXT,
  pool_range TEXT,
  hotspot_server TEXT NOT NULL DEFAULT 'openwifi-hotspot',
  identity TEXT,
  board TEXT,
  version TEXT,
  architecture TEXT,
  serial_number TEXT,
  last_public_ip TEXT,
  last_seen_at INTEGER,
  enrolled_at INTEGER NOT NULL,
  installed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_router_devices_site_seen
  ON router_devices(site_id, enabled, last_seen_at);

CREATE TABLE IF NOT EXISTS router_enrollments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  router_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  install_mode TEXT NOT NULL
    CHECK (install_mode IN ('full','hotspot','agent')),
  wan_interface TEXT,
  lan_ports_json TEXT,
  network_cidr TEXT,
  gateway_ip TEXT,
  pool_range TEXT,
  hotspot_server TEXT NOT NULL DEFAULT 'openwifi-hotspot',
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  router_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_router_enrollments_site_expiry
  ON router_enrollments(site_id, expires_at, used_at);

ALTER TABLE router_hosts ADD COLUMN last_router_id TEXT;

CREATE INDEX IF NOT EXISTS idx_router_hosts_last_router
  ON router_hosts(site_id, last_router_id, last_seen_at);

PRAGMA optimize;
