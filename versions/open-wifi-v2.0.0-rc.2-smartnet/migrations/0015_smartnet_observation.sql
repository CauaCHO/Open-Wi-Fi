-- SmartNet observation only. No RouterOS configuration is changed.
CREATE TABLE IF NOT EXISTS router_telemetry_samples (
  site_id TEXT NOT NULL,
  router_id TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  cpu_load_pct INTEGER CHECK(cpu_load_pct BETWEEN 0 AND 100),
  free_memory_bytes INTEGER CHECK(free_memory_bytes >= 0),
  total_memory_bytes INTEGER CHECK(total_memory_bytes >= 0),
  uptime_text TEXT,
  hotspot_host_count INTEGER CHECK(hotspot_host_count BETWEEN 0 AND 2000),
  source TEXT NOT NULL DEFAULT 'router-poll-v1',
  PRIMARY KEY(router_id, minute_bucket),
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_router_telemetry_site_time
  ON router_telemetry_samples(site_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_router_telemetry_retention
  ON router_telemetry_samples(received_at);

CREATE TABLE IF NOT EXISTS router_capabilities (
  router_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  router_os_major INTEGER,
  cpu_count INTEGER,
  wireless_supported INTEGER,
  queue_types_json TEXT,
  reported_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY(router_id) REFERENCES router_devices(id) ON DELETE CASCADE
);

PRAGMA optimize;
