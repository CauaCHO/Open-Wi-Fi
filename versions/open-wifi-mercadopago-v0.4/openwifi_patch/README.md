# Open Wi‑Fi + Mercado Pago PIX

Protótipo funcional do backend de pagamentos do **Open Wi‑Fi** usando a API Orders do Mercado Pago.

## O que esta versão já faz

- Planos fixos:
  - 1 hora — R$ 2
  - 1 dia — R$ 5
  - 1 semana — R$ 10
  - 30 dias — R$ 25
- Cria uma **Order PIX dinâmica** no Mercado Pago.
- Usa o `qr_code` e `qr_code_base64` retornados pelo Mercado Pago.
- Janela comercial do Open Wi‑Fi de **30 segundos por tentativa**.
- Máximo de **3 tentativas** por dispositivo.
- Depois da 3ª tentativa expirada: **10 minutos de bloqueio**.
- Tenta cancelar no Mercado Pago a cobrança que ficou pendente após os 30 segundos.
- Detecta pagamento aprovado por:
  - Webhook `Order (Mercado Pago)`; ou
  - polling temporário para facilitar teste local.
- Quando o pagamento chega em `processed/accredited`, registra a validade comprada.
- Tem modo `mock`, para testar sem movimentar dinheiro.

## Observação importante sobre os 30 segundos

Na API Orders atual do Mercado Pago, uma cobrança PIX tem vencimento configurável entre **30 minutos e 30 dias**. Por isso o projeto cria o PIX no provedor com `expiration_time: PT30M`, mas o **Open Wi‑Fi encerra a tentativa em 30 segundos** e solicita o cancelamento da Order se ela ainda estiver pendente.

Assim, para o usuário do Wi‑Fi a regra continua sendo 30 segundos.

## 1. Instalar

É necessário Node.js 18 ou superior.

No terminal, dentro desta pasta:

```bash
npm install
```

Crie o arquivo `.env` copiando o exemplo:

### Windows PowerShell

```powershell
Copy-Item .env.example .env
```

### Linux/macOS

```bash
cp .env.example .env
```

Depois:

```bash
npm start
```

Abra:

```text
http://localhost:8080
```

## 2. Testar sem dinheiro real

Deixe:

```env
PAYMENTS_MODE=mock
```

O portal mostrará um PIX fictício e habilitará o botão **Simular pagamento aprovado**.

## 3. Ligar na sua conta Mercado Pago

No Mercado Pago Developers:

1. Acesse **Suas integrações**.
2. Crie uma aplicação para o Open Wi‑Fi.
3. Garanta que sua conta Mercado Pago tenha uma **chave PIX cadastrada**.
4. Abra os dados/credenciais da integração.
5. Copie o **Access Token** apropriado para o ambiente que você está usando.
6. Edite `.env`:

```env
PAYMENTS_MODE=mercadopago
MP_ACCESS_TOKEN=COLE_SEU_ACCESS_TOKEN_AQUI
MP_STATUS_POLLING=true
```

**Nunca coloque o Access Token dentro de `public/app.js`, HTML ou na MikroTik.** Ele pertence somente ao servidor.

Ao reiniciar `npm start`, o portal passará a criar Orders PIX pela conta vinculada a esse Access Token.

## 4. Webhook

Para produção, publique este backend em um endereço HTTPS e configure no Mercado Pago:

- Menu da aplicação: **Webhooks > Configurar notificações**
- URL de produção:

```text
https://SEU-DOMINIO/webhooks/mercadopago
```

- Evento: **Order (Mercado Pago)**

Depois de salvar, o Mercado Pago gera uma **chave secreta do webhook**. Coloque em:

```env
MP_WEBHOOK_SECRET=SUA_CHAVE_SECRETA_DO_WEBHOOK
MP_STATUS_POLLING=false
```

O código valida `x-signature` usando o validador do SDK oficial do Mercado Pago e, em seguida, consulta `/v1/orders/{id}` para conferir o estado real da cobrança.

## 5. Testar simulando a MikroTik

Você pode abrir o portal como se a MikroTik tivesse informado o MAC:

```text
http://localhost:8080/?mac=AA:BB:CC:DD:EE:FF
```

**Isso é somente para desenvolvimento.** No sistema final, não vamos confiar em um `?mac=` digitado pelo próprio cliente. A identificação será entregue/validada pelo fluxo do Hotspot da MikroTik.

## 6. O que ainda falta para o projeto completo

A aprovação do PIX já fica registrada, mas ainda falta ligar a função de autorização ao RouterOS. A próxima etapa será:

```text
PIX aprovado
   ↓
backend Open Wi‑Fi
   ↓
identifica MAC/sessão
   ↓
MikroTik RouterOS
   ↓
libera o dispositivo até accessUntil
```

Também falta trocar o armazenamento JSON por banco de dados antes de uma instalação com muitos usuários simultâneos.

## Segurança

- `.env` está no `.gitignore`.
- Não envie seu Access Token em prints públicos, GitHub ou HTML.
- Webhook deve usar HTTPS e assinatura secreta.
- O backend sempre consulta a Order no Mercado Pago antes de considerar o PIX pago.
- Um pagamento confirmado deve ser honrado mesmo se ocorrer muito próximo do limite de 30 segundos; o código trata a corrida entre pagamento e cancelamento consultando novamente a Order.

## Correção v0.3.0 — QR PIX

- A criação da Order pode ser assíncrona; agora o backend consulta a Order enquanto aguarda os dados PIX.
- Se o Mercado Pago devolver `qr_code` mas `qr_code_base64` vazio (situação possível no sandbox), o backend gera a imagem QR localmente.
- Erros do provedor agora aparecem com mais detalhes no terminal/API sem expor o Access Token.

Para cobrar valores reais dos planos, use o **Access Token de produção** em `MP_ACCESS_TOKEN` e mantenha `PAYMENTS_MODE=mercadopago`.


## Teste PIX no sandbox do Mercado Pago

Para validar automaticamente o PIX com credenciais de teste, use:

```env
PAYMENTS_MODE=mercadopago
MP_ENV=sandbox
MP_ACCESS_TOKEN=SEU_TOKEN_DE_TESTE
MP_STATUS_POLLING=true
```

No formulário, informe um e-mail terminado em `@testuser.com`. Em `MP_ENV=sandbox`, o backend envia ao Mercado Pago o cenário oficial de teste (`payer.first_name = APRO` e `R$ 50,00`). Esse valor é fictício e serve somente para fazer a Order mudar automaticamente de `action_required/waiting_transfer` para `processed/accredited`. O Open Wi-Fi mantém localmente o plano selecionado (R$2/R$5/R$10/R$25).

Para produção, altere para `MP_ENV=production` e use o Access Token de produção.

Durante testes, você pode usar `ATTEMPT_WINDOW_MS=60000` e `COOLDOWN_MS=15000`. Em produção, volte para `30000` e `600000`.
