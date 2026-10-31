# Open Wi‑Fi + Mercado Pago + MikroTik — v0.6

A v0.6 conecta o fluxo que já funcionava no Mercado Pago à MikroTik.

## Fluxo

```text
Cliente entra no HotSpot
        ↓
Open Wi-Fi identifica MAC
        ↓
Escolhe plano e gera PIX
        ↓
RB libera MAC temporariamente por 30 s
        ↓
30 s acabou? remove o bypass temporário
        ↓
QR PIX CONTINUA VÁLIDO
        ↓
Mercado Pago confirma o PIX
        ↓
RB cria bypass pago para o MAC
        ↓
1h / 1d / 7d / 30d
        ↓
backend remove o bypass no vencimento
```

A cobrança PIX continua ativa mesmo depois que a janela temporária acaba. Mesmo MAC + mesmo plano reaproveita a mesma Order enquanto ela estiver válida.

## Planos

- 1 hora — R$ 2
- 1 dia — R$ 5
- 1 semana — R$ 10
- 30 dias — R$ 25

## Instalação

Requer Node.js 18+.

```cmd
npm install
copy .env.example .env
notepad .env
npm start
```

## Primeiro teste: Mercado Pago real, MikroTik mock

```env
PAYMENTS_MODE=mercadopago
MP_ENV=production
MP_ACCESS_TOKEN=SEU_ACCESS_TOKEN_DE_PRODUCAO
MP_STATUS_POLLING=true

MIKROTIK_MODE=mock
```

## Ativar a MikroTik

Primeiro siga `mikrotik/SETUP.md`.

Depois:

```env
MIKROTIK_MODE=real
MIKROTIK_HOST=192.168.88.1
MIKROTIK_USER=openwifi
MIKROTIK_PASSWORD=SUA_SENHA_FORTE
MIKROTIK_USE_TLS=false
MIKROTIK_PORT=8728
MIKROTIK_HOTSPOT_SERVER=all
MIKROTIK_DEVICE_VALIDATION=prefer-router
```

Para laboratório, 8728 deve ficar restrita ao IP do notebook/backend. Não exponha essa porta à Internet.

Teste a RB sem fazer PIX:

```text
http://localhost:8080/api/mikrotik/test
```

## Desenvolvimento rápido

```env
ATTEMPT_WINDOW_MS=10000
COOLDOWN_MS=15000
MAX_ATTEMPTS=3
PIX_VALIDITY_MS=1800000
```

Para a regra final:

```env
ATTEMPT_WINDOW_MS=30000
COOLDOWN_MS=600000
MAX_ATTEMPTS=3
```

## Identificação do dispositivo

Em `MIKROTIK_MODE=real`, o backend trabalha com MAC. Há três modos:

```env
MIKROTIK_DEVICE_VALIDATION=prefer-router
```

Tenta identificar o MAC pela tabela HotSpot usando o IP da requisição e, em laboratório, permite cair para o MAC informado pelo portal.

```env
MIKROTIK_DEVICE_VALIDATION=strict-router
```

Recomendado quando o backend está local: só aceita o MAC visto pela própria MikroTik.

```env
MIKROTIK_DEVICE_VALIDATION=trust-portal
```

Somente desenvolvimento: confia no `?mac=` recebido da página.

## Estado persistente e expiração

`data/store.json` registra pagamentos e validades. A cada `MIKROTIK_RECONCILE_MS` (30 s por padrão), o backend:

- remove bindings Open Wi-Fi vencidos;
- restaura acessos pagos ainda válidos depois de reinício;
- tenta novamente uma sincronização que tenha falhado.

O pagamento nunca volta para "não pago" por falha da RB. Se o Mercado Pago aprovou e a MikroTik estiver indisponível, a tentativa fica marcada como erro de sincronização e o reconciliador tenta novamente.

## API-SSL

A v0.6 também suporta API-SSL:

```env
MIKROTIK_USE_TLS=true
MIKROTIK_PORT=8729
MIKROTIK_TLS_VERIFY=true
```

Configure antes o certificado no serviço `api-ssl` do RouterOS.

## Segurança

- não coloque `MP_ACCESS_TOKEN` nem a senha da RB no front-end;
- não envie `.env` para GitHub;
- use usuário RouterOS exclusivo para o Open Wi-Fi;
- restrinja a API ao IP do backend;
- não exponha 8728 à Internet;
- em produção local, use `strict-router` para não confiar no MAC enviado pelo navegador;
- mantenha o backend online, pois nesta versão ele também é responsável por remover `ip-binding` no vencimento.

## Painel administrativo (v0.7)

Acesse `http://IP_DO_BACKEND:8080/admin`. Configure antes no `.env`:

```env
ADMIN_USER=admin
ADMIN_PASSWORD=troque-por-uma-senha-forte
ADMIN_SESSION_SECRET=use-uma-sequencia-aleatoria-longa
ADMIN_TIMEZONE=America/Sao_Paulo
MP_FEE_PERCENT=1
MONTHLY_FIXED_COST=0
```

O painel mostra conectados agora (via `/ip hotspot host`), hostname/IP/MAC (complementado pelas leases DHCP), e-mail e plano da última compra, acessos pagos ativos, compras do dia, faturamento e lucro mensal estimado.

`Lucro estimado = faturamento do mês - taxa percentual estimada - custo fixo mensal`. Ajuste `MP_FEE_PERCENT` e `MONTHLY_FIXED_COST` conforme seus custos reais.

Para acesso remoto, não encaminhe a porta 8080 diretamente para a Internet. Use HTTPS por VPN/túnel reverso (por exemplo Tailscale/Cloudflare Tunnel) e então defina `ADMIN_COOKIE_SECURE=true`.
