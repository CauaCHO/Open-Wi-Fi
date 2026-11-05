-- SmartNet control/observability data. No RouterOS command is applied by this migration.
CREATE TABLE IF NOT EXISTS smartnet_policies (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  router_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'observe' CHECK(mode IN ('observe','recommend','automatic')),
  profile TEXT NOT NULL DEFAULT 'standard' CHECK(profile IN ('standard','pcq','fq_codel','cake')),
  site_down_kbps INTEGER NOT NULL DEFAULT 0 CHECK(site_down_kbps BETWEEN 0 AND 10000000),
  site_up_kbps INTEGER NOT NULL DEFAULT 0 CHECK(site_up_kbps BETWEEN 0 AND 10000000),
  revision INTEGER NOT NULL DEFAULT 1,
  verified_at INTEGER,
  fasttrack_verified INTEGER NOT NULL DEFAULT 0 CHECK(fasttrack_verified IN (0,1)),
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_smartnet_policies_site ON smartnet_policies(site_id,router_id);

CREATE TABLE IF NOT EXISTS smartnet_policy_versions (
  policy_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(policy_id,revision),
  FOREIGN KEY(policy_id) REFERENCES smartnet_policies(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS smartnet_policy_actions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  router_id TEXT NOT NULL,
  policy_id TEXT,
  revision INTEGER,
  action TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('proposed','approved','applied','rejected','rolled_back')),
  before_json TEXT,
  after_json TEXT,
  actor TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE CASCADE,
  FOREIGN KEY(policy_id) REFERENCES smartnet_policies(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_smartnet_actions_router_time ON smartnet_policy_actions(router_id,created_at DESC);

CREATE TABLE IF NOT EXISTS smartnet_qoe_measurements (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  router_id TEXT,
  source TEXT NOT NULL CHECK(source IN ('browser_voluntary','router','ap')),
  latency_ms REAL CHECK(latency_ms BETWEEN 0 AND 60000),
  jitter_ms REAL CHECK(jitter_ms BETWEEN 0 AND 60000),
  packet_loss_pct REAL CHECK(packet_loss_pct BETWEEN 0 AND 100),
  request_failure_pct REAL CHECK(request_failure_pct BETWEEN 0 AND 100),
  down_kbps INTEGER CHECK(down_kbps BETWEEN 0 AND 10000000),
  up_kbps INTEGER CHECK(up_kbps BETWEEN 0 AND 10000000),
  load_ms REAL CHECK(load_ms BETWEEN 0 AND 120000),
  captured_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_smartnet_qoe_router_time ON smartnet_qoe_measurements(site_id,router_id,captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_smartnet_qoe_retention ON smartnet_qoe_measurements(captured_at);

CREATE TABLE IF NOT EXISTS smartnet_access_points (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  router_id TEXT,
  name TEXT NOT NULL,
  vendor TEXT,
  model TEXT,
  management_mode TEXT NOT NULL DEFAULT 'inventory' CHECK(management_mode IN ('inventory','routeros_wireless','routeros_wifi','vendor_adapter')),
  radio_capable INTEGER NOT NULL DEFAULT 0 CHECK(radio_capable IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_smartnet_aps_site_router ON smartnet_access_points(site_id,router_id);

CREATE TABLE IF NOT EXISTS smartnet_ap_samples (
  ap_id TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  client_count INTEGER CHECK(client_count BETWEEN 0 AND 10000),
  channel INTEGER,
  channel_util_pct INTEGER CHECK(channel_util_pct BETWEEN 0 AND 100),
  median_rssi_dbm INTEGER CHECK(median_rssi_dbm BETWEEN -120 AND 0),
  noise_dbm INTEGER,
  slow_client_count INTEGER CHECK(slow_client_count BETWEEN 0 AND 10000),
  source TEXT NOT NULL,
  PRIMARY KEY(ap_id,minute_bucket),
  FOREIGN KEY(ap_id) REFERENCES smartnet_access_points(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_smartnet_ap_samples_time ON smartnet_ap_samples(captured_at);

CREATE TABLE IF NOT EXISTS smartnet_dns_probes (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  router_id TEXT,
  resolver TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('browser','router','worker')),
  latency_ms REAL CHECK(latency_ms BETWEEN 0 AND 60000),
  success INTEGER NOT NULL CHECK(success IN (0,1)),
  captured_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_smartnet_dns_site_time ON smartnet_dns_probes(site_id,router_id,captured_at DESC);

CREATE TABLE IF NOT EXISTS smartnet_cluster_members (
  router_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  sector TEXT NOT NULL,
  link_down_kbps INTEGER NOT NULL DEFAULT 0 CHECK(link_down_kbps BETWEEN 0 AND 10000000),
  link_up_kbps INTEGER NOT NULL DEFAULT 0 CHECK(link_up_kbps BETWEEN 0 AND 10000000),
  weight INTEGER NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 100),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE CASCADE,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_smartnet_cluster_site ON smartnet_cluster_members(site_id,enabled);

CREATE TABLE IF NOT EXISTS smartnet_incidents (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  router_id TEXT,
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
  confidence_pct INTEGER NOT NULL CHECK(confidence_pct BETWEEN 0 AND 100),
  evidence_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','acknowledged','resolved')),
  opened_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_smartnet_incidents_site ON smartnet_incidents(site_id,state,opened_at DESC);

CREATE TABLE IF NOT EXISTS smartnet_experiments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','running','completed','cancelled')),
  design_json TEXT NOT NULL,
  results_json TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_smartnet_experiments_site ON smartnet_experiments(site_id,created_at DESC);

PRAGMA optimize;
