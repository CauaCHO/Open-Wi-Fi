# Open Wi-Fi v1.0 Cloudflare — Fase 2A

Objetivo desta fase:

**Padrão → plano → Pix Mercado Pago → webhook → access_grant → MikroTik libera MAC.**

A Fase 1.2 continua dentro desta versão. O script da RB não precisa mudar.

## O que entra agora

- Portal público em `/portal`.
- Planos Padrão vindos do D1.
- Registro do Device ID + MAC.
- Validação de que o MAC foi visto pela MikroTik.
- Checkout Transparente / Mercado Pago Orders API.
- Pix QR + Pix Copia e Cola SEM links externos.
- Reutilização da mesma order pendente para mesmo aparelho + plano.
- Janela inicial visual de 30 segundos sem invalidar o Pix.
- Webhook `Order (Mercado Pago)` com validação HMAC.
- Fallback consultando `GET /v1/orders/{id}` quando necessário.
- Pagamento aprovado cria `access_grant` uma única vez.
- A RB libera no próximo poll (~10 s).
- Reembolso/cancelamento/falha revoga grant ativo.

## 1. Instalar

```cmd
npm install
```

## 2. Aplicar migration

```cmd
npm run db:migrate:remote
```

Deve aplicar:

`0004_phase2a_pix.sql`

## 3. Colocar o Access Token do Mercado Pago no Worker

Use o token de PRODUÇÃO que já funcionou no projeto antigo:

```cmd
npx wrangler secret put MP_ACCESS_TOKEN
```

Cole o token quando solicitado.

NÃO coloque o token no `wrangler.toml`, JavaScript ou chat.

## 4. Deploy

```cmd
npm run deploy
```

Abra:

`https://openwifi-api.cauaholiveira06.workers.dev/health`

Esperado:

```json
{
  "version": "1.0.0-phase2A",
  "mercadoPagoConfigured": true
}
```

É normal `webhookSecretConfigured` ainda estar `false`.

## 5. Configurar o Webhook no Mercado Pago

Na aplicação Open Wi-Fi:

Suas integrações → Open Wi-Fi → Webhooks → Configurar notificações → Produção

URL:

`https://openwifi-api.cauaholiveira06.workers.dev/api/mercadopago/webhook`

Evento:

`Order (Mercado Pago)`

Salve.

O Mercado Pago vai gerar uma chave secreta de Webhook.

## 6. Salvar a chave secreta de Webhook na Cloudflare

```cmd
npx wrangler secret put MP_WEBHOOK_SECRET
```

Cole a chave secreta mostrada pelo Mercado Pago.

Depois confirme em:

`/health`

Esperado:

`"webhookSecretConfigured": true`

## 7. Simular o webhook

No próprio painel Mercado Pago, use o botão Simular para o tópico Order.

O endpoint deve responder HTTP 200 quando a assinatura for válida.

## 8. Walled Garden

Antes de trocar o login.html, autorize o domínio do Worker:

```routeros
/ip hotspot walled-garden add action=allow dst-host=openwifi-api.cauaholiveira06.workers.dev comment="OpenWiFi Cloud Portal"
```

Confira:

```routeros
/ip hotspot walled-garden print detail where comment="OpenWiFi Cloud Portal"
```

## 9. NÃO troque o login.html ainda

Primeiro teste o portal manualmente com um MAC real visto pela RB:

`https://openwifi-api.cauaholiveira06.workers.dev/portal?site=openwifi-main&mac=SEU_MAC`

Use um aparelho SEM binding manual.

Se o portal mostrar os planos, faça o teste real do plano R$ 2.

## 10. Teste real

Fluxo esperado:

1. Portal identifica o MAC.
2. Escolha `1 hora — R$ 2`.
3. Informe o e-mail.
4. Worker cria Order Pix.
5. Página mostra QR + Copia e Cola.
6. Faça o Pix.
7. Webhook chega.
8. Worker consulta a Order.
9. Status `processed/accredited` vira `approved`.
10. Worker cria access_grant de 1 hora.
11. Em até ~10 s a RB cria `OpenWiFi Cloud`.
12. Celular navega.

Confira pagamentos:

```cmd
npm run payments:check
```

Confira RB:

```routeros
/ip hotspot ip-binding print detail where comment="OpenWiFi Cloud"
```

## 11. Só depois do teste R$ 2

Se o teste manual funcionar, copie:

`mikrotik/login-cloud.html`

para:

`Files → hotspot → login.html`

ou substitua o `login.html` atual.

A partir daí o captive portal passa a abrir a Cloudflare.

## Segurança

Secrets necessários no Worker:

- `ROUTER_API_TOKEN`
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`

Nunca coloque esses três no frontend.

## Próxima fase

Depois de validar o R$ 2:

- Fase 2B: anti-abuso completo (3 tentativas / cooldown).
- Party Mode.
- WhatsApp obrigatório no Party.
- Vale Night.
- Dupla / Quarteto.
- códigos de grupo.
- tela pública read-only do grupo.
