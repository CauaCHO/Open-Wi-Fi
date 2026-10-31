# Open Wi-Fi v1.0 Cloudflare — Fase 1.2

Esta versão endurece a ponte Cloudflare ↔ MikroTik antes da integração PIX.

## O que mudou

- O poll da RB continua a cada 10 segundos.
- O Worker não grava todos os hosts no D1 a cada 10 segundos.
- Heartbeat/telemetria persistida: aproximadamente 30 segundos.
- `router_hosts` é sincronizada em intervalos maiores e só escreve hosts novos,
  alterados, removidos ou que precisam de um refresh periódico.
- Grants vencidos mudam de `active` para `expired`.
- Novos índices reduzem leituras no join `access_grants -> device_macs`.
- A RB derruba HotSpot Active e Cookie do MAC ao revogar.
- Log da RB fica silencioso em polls normais.
- Bindings manuais continuam intocados.

## Por que economizar D1

Num evento, gravar 250 clientes a cada 10 segundos significaria centenas de
milhares de rows written por dia. Isso não combina com o D1 Free.

A Fase 1.2 separa:

- controle de acesso: 10 s
- heartbeat/snapshot persistido: ~30 s
- atualização periódica de `last_seen_at` de hosts estáveis: 30 min

Assim, a liberação continua rápida sem transformar cada poll em centenas de writes.

## Instalação

### 1. Copie seus arquivos atuais, se quiser backup

Não apague a versão anterior até terminar o teste.

### 2. Preserve o ROUTER_API_TOKEN

O token é Secret da Cloudflare e não está neste ZIP.

Não rode `wrangler secret put` de novo se o secret atual já está correto.

### 3. Instale dependências

```cmd
npm install
```

### 4. Aplique a migration nova

```cmd
npm run db:migrate:remote
```

O esperado é aplicar:

`0003_phase12_indexes.sql`

### 5. Publique o Worker

```cmd
npm run deploy
```

### 6. Teste health

Abra:

`https://openwifi-api.cauaholiveira06.workers.dev/health`

Esperado:

`"version": "1.0.0-phase1.2"`

### 7. Atualize o script da MikroTik

Abra:

`mikrotik/openwifi-cloud-poll.rsc`

Copie o conteúdo para:

System → Scripts → `openwifi-cloud-poll`

Antes de salvar, substitua:

`SEU_TOKEN_AQUI`

pela ROUTER_API_TOKEN nova que já está no Worker.

NÃO envie essa chave em chat ou print.

O scheduler existente de 10 segundos pode continuar exatamente como está.

## Teste de 5 minutos

No CMD/PowerShell do WINDOWS, não no terminal MikroTik:

```cmd
npx wrangler d1 execute DB --remote --command="UPDATE access_grants SET starts_at=unixepoch('now')*1000, ends_at=(unixepoch('now')*1000)+300000, status='active', updated_at=unixepoch('now')*1000 WHERE id='test-grant-1';"
```

A RB deve criar o binding em até ~10 s.

Confira:

```routeros
/ip hotspot ip-binding print detail where comment="OpenWiFi Cloud"
```

Depois de ~5 min o binding deve desaparecer.

Confira o status no banco:

```cmd
npx wrangler d1 execute DB --remote --command="SELECT id,status,starts_at,ends_at FROM access_grants WHERE id='test-grant-1';"
```

Após o próximo poll depois da expiração, o status deve ser:

`expired`

## Importante

Ainda não altere o HotSpot `login.html`.
Ainda não remova a v0.9.4/local.
Ainda não desabilite a API 8728.

Esses cortes serão feitos somente após Mercado Pago + portal funcionarem na Cloudflare.
