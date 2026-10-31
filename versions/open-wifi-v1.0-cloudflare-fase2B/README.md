# Open Wi-Fi v1.0 Cloudflare — Fase 2B

## Objetivo

Fechar o captive portal Padrão com a regra anti-abuso original:

- QR Pix continua válido até o vencimento da cobrança.
- A página não abre banco, Mercado Pago ou WhatsApp.
- Depois de gerar o Pix, o usuário pode pedir **30 s de internet temporária**.
- Máximo de **3 janelas**.
- Depois da terceira, começa **cooldown de 10 min** ao terminar a janela.
- O cooldown bloqueia apenas novas janelas temporárias.
- Se o Pix for pago durante o cooldown ou muito depois dos 30 s, o pagamento aprovado continua liberando normalmente.
- Mesmo aparelho + mesmo plano + mesma cobrança pendente reutiliza a mesma Order Pix.

## Arquitetura da tentativa

Ao clicar "Liberar internet por 30 s":

Portal
→ POST /api/payments/:id/attempt
→ D1 access_attempts
→ Worker passa o MAC no próximo /api/router/poll
→ RB cria OpenWiFi Cloud bypass
→ 30 s depois a tentativa expira
→ próximo poll remove o bypass, a menos que exista access_grant pago.

Quando o pagamento é aprovado durante a janela:

access_attempt.status → converted
+
access_grant pago → active

Essas duas operações usam D1 batch().

## 1. Instalar

```cmd
npm install
```

## 2. Migration

```cmd
npm run db:migrate:remote
```

Deve aplicar:

`0005_phase2b_attempts.sql`

## 3. Deploy

Os secrets existentes continuam valendo:

- ROUTER_API_TOKEN
- MP_ACCESS_TOKEN
- MP_WEBHOOK_SECRET

Não recrie os secrets.

```cmd
npm run deploy
```

Verifique:

`https://openwifi-api.cauaholiveira06.workers.dev/health`

Esperado:

`"version": "1.0.0-phase2B"`

## 4. Walled Garden

O domínio do portal precisa estar acessível antes da autenticação:

```routeros
/ip hotspot walled-garden add action=allow dst-host=openwifi-api.cauaholiveira06.workers.dev comment="OpenWiFi Cloud Portal"
```

Se já existe, não duplique.

Confira:

```routeros
/ip hotspot walled-garden print detail where comment="OpenWiFi Cloud Portal"
```

## 5. Teste manual antes de trocar login.html

Use um MAC real atualmente visto em `/ip hotspot host`, sem bypass manual:

`https://openwifi-api.cauaholiveira06.workers.dev/portal?site=openwifi-main&mac=SEU_MAC`

Fluxo:

1. Escolha 1 hora / R$ 2.
2. Gere o Pix.
3. Copie o Pix.
4. Clique "Liberar internet por 30 s".
5. Em até ~10 s deve aparecer `OpenWiFi Cloud` na RB.
6. Depois de ~30 s deve ser removido se o Pix ainda não foi pago.
7. Repita até 3 vezes.
8. Depois da terceira, o portal mostra o cooldown.
9. Mesmo durante o cooldown, pague o QR original.
10. O webhook deve criar o grant pago e a RB deve liberar.

## 6. Ver as tentativas

No CMD:

```cmd
npm run attempts:check
```

## 7. Cutover do captive portal

Somente depois do teste manual:

- faça backup do `hotspot/login.html` atual;
- copie `mikrotik/login-cloud-phase2b.html` para o diretório `hotspot`;
- renomeie para `login.html`.

No WinBox:

Files → hotspot → login.html

O captive portal passa a redirecionar para Cloudflare.

## 8. Teste final real

Use um aparelho sem bypass:

- esqueça a rede;
- conecte novamente;
- captive portal deve abrir;
- plano R$ 2;
- Pix;
- janela 30 s;
- pagamento;
- grant de 1 hora.

Verifique:

```cmd
npm run payments:check
npm run attempts:check
```

Na RB:

```routeros
/ip hotspot ip-binding print detail where comment="OpenWiFi Cloud"
```

## 9. Rollback

Se o captive portal não abrir depois da troca:

1. restaure o `login.html` anterior;
2. mantenha o Worker e D1 rodando;
3. não remova o scheduler `openwifi-cloud-poll`.

A arquitetura da Fase 1.2 continua independente do login.html.

## Próxima fase

Fase 3:

- Party Mode
- evento início/fim
- WhatsApp obrigatório
- Vale Night
- Combo Dupla
- Quarteto
- código único de grupo
- slots imutáveis
- página pública read-only do grupo
- recuperação por WhatsApp no admin
