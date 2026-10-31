# Open Wi-Fi v1.0 Cloudflare — Fase 1

Esta fase NÃO substitui a v0.9.4 ainda.

Objetivo:
1. Criar schema D1.
2. Publicar o Worker.
3. Configurar `ROUTER_API_TOKEN` como Secret.
4. Testar Worker ↔ D1.
5. Testar MikroTik → Worker por HTTPS.
6. Só depois mover portal/PIX.

## 1. Descobrir o Database ID

No painel Cloudflare:
D1 → openwifi-db → Overview/Settings → Database ID

ou com Wrangler após login:

```bash
npx wrangler d1 info openwifi-db
```

Copie o UUID para `wrangler.toml` em:

```toml
database_id = "..."
```

## 2. Instalar

```bash
npm install
npx wrangler login
```

## 3. Aplicar migrations no D1 remoto

```bash
npm run db:migrate:remote
```

Valide:

```bash
npm run db:check
```

## 4. Criar segredo da MikroTik

Gere uma chave longa aleatória localmente. Exemplo PowerShell:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Depois:

```bash
npx wrangler secret put ROUTER_API_TOKEN
```

Cole o segredo quando solicitado.

## 5. Deploy

```bash
npm run deploy
```

## 6. Testes

Abra:

- `/health`
- `/api/site/status`

Teste o poll com curl:

```bash
curl -X POST "https://SEU-WORKER.workers.dev/api/router/poll" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"siteId":"openwifi-main","router":{"identity":"teste","board":"hEX","version":"7.16.1"},"hosts":[]}'
```

Depois recarregue `/api/site/status`. `routerOnline` deve ficar `true`.

## Importante

Não coloque o Access Token do Mercado Pago nesta fase.
Não altere o `login.html` da MikroTik ainda.
Não desligue a v0.9.4 atual.
