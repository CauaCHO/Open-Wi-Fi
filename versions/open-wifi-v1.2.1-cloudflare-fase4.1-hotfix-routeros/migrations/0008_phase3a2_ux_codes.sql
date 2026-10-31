-- Open Wi-Fi Cloudflare v1.0 - Fase 3A.2
-- UX do painel/captive portal + códigos com duração configurável ou permanentes.

ALTER TABLE access_codes ADD COLUMN is_permanent INTEGER NOT NULL DEFAULT 0
  CHECK (is_permanent IN (0,1));

ALTER TABLE sites ADD COLUMN about_title TEXT NOT NULL DEFAULT 'Conheça o Open Wi-Fi';
ALTER TABLE sites ADD COLUMN about_text TEXT NOT NULL DEFAULT
  'O Open Wi-Fi oferece acesso simples e rápido à internet por meio de um portal seguro. Escolha uma forma de acesso, faça a liberação e navegue sem complicação.';

CREATE INDEX IF NOT EXISTS idx_access_codes_site_permanent
  ON access_codes(site_id, is_permanent, status, created_at);

PRAGMA optimize;
