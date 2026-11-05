INSERT OR IGNORE INTO sites (
  id, name, mode, created_at, updated_at
) VALUES (
  'openwifi-main', 'Open Wi-Fi', 'standard',
  unixepoch('now') * 1000, unixepoch('now') * 1000
);

INSERT OR IGNORE INTO plans
(id, site_id, mode, slug, name, price_cents, duration_seconds, party_until_event_end, max_devices, enabled, sort_order, created_at, updated_at)
VALUES
('plan-standard-1h',   'openwifi-main', 'standard', '1h',      '1 hora',     200,  3600,    0, 1, 1, 10, unixepoch('now')*1000, unixepoch('now')*1000),
('plan-standard-1d',   'openwifi-main', 'standard', '1d',      '1 dia',      500,  86400,   0, 1, 1, 20, unixepoch('now')*1000, unixepoch('now')*1000),
('plan-standard-7d',   'openwifi-main', 'standard', '7d',      '1 semana',  1000,  604800,  0, 1, 1, 30, unixepoch('now')*1000, unixepoch('now')*1000),
('plan-standard-30d',  'openwifi-main', 'standard', '30d',     '30 dias',   2500,  2592000, 0, 1, 1, 40, unixepoch('now')*1000, unixepoch('now')*1000),
('plan-party-1h',      'openwifi-main', 'party',    'party-1h','1 hora',     200,  3600,    0, 1, 1, 10, unixepoch('now')*1000, unixepoch('now')*1000),
('plan-party-night',   'openwifi-main', 'party',    'night',   'Vale Night', 500,  NULL,    1, 1, 1, 20, unixepoch('now')*1000, unixepoch('now')*1000),
('plan-party-dupla',   'openwifi-main', 'party',    'dupla',   'Combo Dupla',800,  NULL,    1, 2, 1, 30, unixepoch('now')*1000, unixepoch('now')*1000),
('plan-party-quarteto','openwifi-main', 'party',    'quarteto','Quarteto',  1200,  NULL,    1, 4, 1, 40, unixepoch('now')*1000, unixepoch('now')*1000);
