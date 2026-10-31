# Open Wi‑Fi + Mercado Pago PIX — v0.5

Backend/protótipo do **Open Wi‑Fi** com PIX via Mercado Pago e controle de janelas temporárias por dispositivo.

## Regra v0.5

A regra foi alterada para separar **a validade do PIX** da **janela de internet temporária**:

- O QR PIX **não é cancelado** quando os 30 segundos terminam.
- A cobrança continua válida até o vencimento configurado no Mercado Pago (nesta versão, `PT30M`).
- Os 30 segundos controlam somente a janela temporária usada para concluir o pagamento.
- Mesmo depois dos 30 s, o backend continua consultando/recebendo o pagamento. Se o PIX for aprovado depois, o plano é liberado normalmente.
- Mesmo dispositivo + mesmo plano reutiliza a **mesma Order e o mesmo QR PIX** enquanto a cobrança estiver válida.
- Cada nova tentativa reabre uma janela temporária, mas **não cria outro PIX** para o mesmo plano.
- São permitidas 3 janelas. Depois da terceira, há cooldown de 10 minutos para abrir outra janela.
- Durante o cooldown, o QR já existente continua visível e pagável.
- Quando o cooldown termina, o mesmo QR pode ser usado numa nova janela se ainda estiver válido.
- Um pagamento confirmado zera o contador/cooldown.

Exemplo:

```text
Escolhe 1 hora — R$2
        ↓
Mercado Pago cria 1 Order / 1 QR
        ↓
Janela 1/3 — 30 s
        ↓ termina
QR CONTINUA VÁLIDO
        ↓
Janela 2/3 — reaproveita o mesmo QR
        ↓
Janela 3/3 — reaproveita o mesmo QR
        ↓
Cooldown 10 min
        ↓
QR CONTINUA PAGÁVEL
        ↓
PIX aprovado a qualquer momento
        ↓
Plano liberado
```

> A integração real da MikroTik ainda está em `MIKROTIK_MODE=mock`. Nesta etapa, "janela de internet temporária" é o estado que depois será ligado às regras da RB.

## Planos

- 1 hora — R$ 2
- 1 dia — R$ 5
- 1 semana — R$ 10
- 30 dias — R$ 25

## Instalação

É necessário Node.js 18 ou superior.

```bash
npm install
```

Crie o `.env`:

### Windows CMD

```cmd
copy .env.example .env
```

### PowerShell

```powershell
Copy-Item .env.example .env
```

Depois:

```bash
npm start
```

Abra `http://localhost:8080`.

## Configuração de produção do Mercado Pago

```env
PAYMENTS_MODE=mercadopago
PORT=8080
MP_ENV=production
MP_ACCESS_TOKEN=SEU_ACCESS_TOKEN_DE_PRODUCAO
MP_WEBHOOK_SECRET=
MP_STATUS_POLLING=true
MIKROTIK_MODE=mock

ATTEMPT_WINDOW_MS=30000
COOLDOWN_MS=600000
MAX_ATTEMPTS=3
PIX_VALIDITY_MS=1800000
```

O `PIX_VALIDITY_MS` acompanha os 30 minutos enviados ao Mercado Pago como `expiration_time: PT30M`.

## Configuração rápida para desenvolvimento

Para não esperar durante os testes:

```env
ATTEMPT_WINDOW_MS=10000
COOLDOWN_MS=15000
MAX_ATTEMPTS=3
PIX_VALIDITY_MS=1800000
```

Na v0.5 esses valores do `.env` são lidos corretamente em tempo de execução.

## Sandbox

```env
PAYMENTS_MODE=mercadopago
MP_ENV=sandbox
MP_ACCESS_TOKEN=SEU_TOKEN_DE_TESTE
MP_STATUS_POLLING=true
```

Use um e-mail `@testuser.com`. O backend usa o cenário de aprovação do sandbox e mantém os valores dos planos apenas no Open Wi‑Fi.

## Webhook

Quando o backend estiver publicado em HTTPS, configure no Mercado Pago:

```text
https://SEU-DOMINIO/webhooks/mercadopago
```

Depois preencha `MP_WEBHOOK_SECRET` e, quando o webhook estiver estável, você pode desativar o polling.

## Simular MAC da MikroTik

Durante o desenvolvimento:

```text
http://localhost:8080/?mac=AA:BB:CC:DD:EE:FF
```

No sistema final o MAC não será confiado ao navegador; ele virá do fluxo controlado pela MikroTik.

## Segurança

- Não coloque `MP_ACCESS_TOKEN` no HTML/JavaScript público.
- Não envie o `.env` para GitHub.
- O webhook deve usar HTTPS e validação de assinatura.
- O backend confirma o estado da Order antes de liberar o acesso.
- A janela de 30 s nunca cancela uma cobrança PIX válida.
