PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'standard'
    CHECK (mode IN ('standard','party')),
  router_last_seen_at INTEGER,
  router_version TEXT,
  router_board TEXT,
  router_identity TEXT,
  router_host_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('standard','party','both')),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  duration_seconds INTEGER,
  party_until_event_end INTEGER NOT NULL DEFAULT 0 CHECK (party_until_event_end IN (0,1)),
  max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices >= 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE(site_id, slug)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','active','ended','cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  phone_e164 TEXT,
  payer_email TEXT,
  hostname TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_macs (
  site_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  device_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(site_id, mac),
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  device_id TEXT,
  plan_id TEXT NOT NULL,
  event_id TEXT,
  mp_order_id TEXT,
  payer_email TEXT,
  phone_e164 TEXT,
  amount_cents INTEGER NOT NULL,
  fee_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','expired','cancelled','failed','refunded')),
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL,
  FOREIGN KEY(plan_id) REFERENCES plans(id),
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS access_grants (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  payment_id TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','revoked')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS party_groups (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  owner_device_id TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  code TEXT NOT NULL,
  public_token TEXT NOT NULL,
  max_devices INTEGER NOT NULL CHECK (max_devices >= 2),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY(owner_device_id) REFERENCES devices(id) ON DELETE CASCADE,
  UNIQUE(site_id, code),
  UNIQUE(public_token)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0,1)),
  PRIMARY KEY(group_id, device_id),
  FOREIGN KEY(group_id) REFERENCES party_groups(id) ON DELETE CASCADE,
  FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS router_hosts (
  site_id TEXT NOT NULL,
  mac TEXT NOT NULL,
  ip TEXT,
  hostname TEXT,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(site_id, mac),
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS router_commands (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('allow_mac','remove_mac','sync')),
  mac TEXT,
  expires_at INTEGER,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','acked','failed')),
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  acked_at INTEGER,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plans_site_mode_enabled
  ON plans(site_id, mode, enabled, sort_order);

CREATE INDEX IF NOT EXISTS idx_events_site_status
  ON events(site_id, status, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_devices_site_phone
  ON devices(site_id, phone_e164);

CREATE INDEX IF NOT EXISTS idx_payments_site_created
  ON payments(site_id, created_at);

CREATE INDEX IF NOT EXISTS idx_payments_site_status
  ON payments(site_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_access_site_status_end
  ON access_grants(site_id, status, ends_at);

CREATE INDEX IF NOT EXISTS idx_groups_site_phone
  ON party_groups(site_id, phone_e164, expires_at);

CREATE INDEX IF NOT EXISTS idx_router_hosts_site_seen
  ON router_hosts(site_id, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_commands_site_status_created
  ON router_commands(site_id, status, created_at);

PRAGMA optimize;
