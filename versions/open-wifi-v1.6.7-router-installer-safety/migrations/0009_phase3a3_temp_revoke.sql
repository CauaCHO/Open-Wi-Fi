-- Open Wi-Fi Cloudflare v1.0 - Fase 3A.3
-- O temporário passa a contar a partir do poll da MikroTik.
-- "Desativar" deixa de ser bloqueio e passa a ser revogação do acesso atual.

ALTER TABLE access_attempts ADD COLUMN router_started_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_attempts_router_start
  ON access_attempts(site_id, status, router_started_at, ends_at);

-- Remove qualquer bloqueio administrativo deixado pela Fase 3A.1/3A.2.
-- As colunas permanecem somente por compatibilidade de schema.
UPDATE devices
   SET admin_blocked = 0,
       admin_block_reason = NULL,
       admin_blocked_at = NULL
 WHERE admin_blocked <> 0
    OR admin_block_reason IS NOT NULL
    OR admin_blocked_at IS NOT NULL;

PRAGMA optimize;
