-- Fase 1.2: índices para o poll Cloudflare -> MikroTik.
-- Evita varrer device_macs inteiro para cada grant ativo.

CREATE INDEX IF NOT EXISTS idx_device_macs_site_device
  ON device_macs(site_id, device_id);

CREATE INDEX IF NOT EXISTS idx_access_grants_site_status_end_device
  ON access_grants(site_id, status, ends_at, device_id);

PRAGMA optimize;
