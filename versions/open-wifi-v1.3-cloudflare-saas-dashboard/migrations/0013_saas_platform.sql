-- Open Wi-Fi v1.3 — SaaS Platform
-- Metadados comerciais dos estabelecimentos sem alterar a tabela sites legada.

CREATE TABLE IF NOT EXISTS site_profiles (
  site_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  venue_type TEXT NOT NULL DEFAULT 'other'
    CHECK (venue_type IN ('nightclub','event','college','restaurant','hotel','store','office','other')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','archived')),
  city TEXT,
  state TEXT,
  address TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_profiles_status
  ON site_profiles(status, display_name);

INSERT OR IGNORE INTO site_profiles(
  site_id,slug,display_name,venue_type,status,timezone,created_at,updated_at
)
SELECT
  id,
  id,
  COALESCE(NULLIF(name,''),id),
  'other',
  'active',
  'America/Sao_Paulo',
  created_at,
  updated_at
FROM sites;

UPDATE router_devices
   SET install_status='installed',
       install_step='complete',
       install_message='Agente Open Wi-Fi ativo'
 WHERE enabled=1
   AND install_status='online'
   AND last_seen_at IS NOT NULL;

PRAGMA optimize;
