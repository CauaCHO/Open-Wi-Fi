# Open Wi-Fi v0.9.2 — pacote completo

Esta é a versão consolidada da v0.9.2.

## Regras desta versão

- **Padrão:** 1h R$2, 1 dia R$5, 7 dias R$10, 30 dias R$25.
- **Party:** 1h R$2, Vale Night R$5, Dupla R$8, Quarteto R$12.
- No **Party Mode, WhatsApp é obrigatório antes de gerar qualquer PIX**.
- O pagamento mostra somente **QR PIX + Copia e Cola**. Não há botão para abrir banco/instituição.
- Convites de Dupla/Quarteto são usados **somente digitando o código aleatório**. Scanner/QR de convite e tokens de convite por URL não são aceitos.
- Depois que o PIX é aprovado, o Open Wi-Fi **não fecha nem redireciona a página automaticamente**. O usuário sai quando quiser.
- O QR PIX não morre junto com a janela de 30 s; somente a internet temporária é encerrada.
- `newlogo.png` é a logo do portal, painel local, Firebase e favicon.
- Device ID lógico permite vincular mais de um MAC ao mesmo aparelho/acesso.

## 1. Atualizando de uma versão anterior

Extraia esta versão em **uma pasta nova**. Não extraia por cima da antiga.

Copie apenas:

```text
.env
data/store.json
secrets/firebase-service-account.json
newlogo.png
```

Não copie `package.json`, `server.mjs`, `src`, `public` ou `firebase-dashboard` antigos.

## 2. Logo

Substitua o `newlogo.png` da raiz pela sua imagem real, mantendo exatamente esse nome.

Ao iniciar, o sistema copia automaticamente a imagem para:

```text
public/newlogo.png
firebase-dashboard/newlogo.png
```

## 3. Instalação

```cmd
npm install
npm run check
npm start
```

Ou use dois cliques em:

```text
Iniciar-Open-WiFi.bat
```

## 4. Firebase

O pacote já está apontando para:

```text
Projeto: open-wi-fi
Hosting: open-wi-fi-ofc
Painel: https://open-wi-fi-ofc.web.app
Site lógico Firestore: openwifi-main
```

A Service Account continua sendo segredo e não vem no ZIP. Coloque-a em:

```text
secrets/firebase-service-account.json
```

Teste:

```cmd
npm run firebase:check
```

Se precisar autorizar sua conta Google:

```cmd
npm run firebase:grant-admin -- SEUEMAIL@gmail.com
```

Depois saia e entre novamente no painel para renovar o token.

### Publicar somente o painel

```cmd
npm run firebase:deploy
```

O comando usa `npx firebase-tools`, portanto não depende de o `firebase-tools` estar instalado globalmente.

Ou dê dois cliques em:

```text
Publicar-Painel-Firebase.bat
```

### Publicar painel + regras + índices

```cmd
npm run firebase:deploy:all
```

### Login do Firebase CLI

Na primeira vez:

```cmd
npm run firebase:login
```

## 5. `.env`

Use `.env.example` como referência. Seus segredos não devem ser colocados em arquivos públicos.

Principais blocos:

```env
MIKROTIK_MODE=real
MIKROTIK_HOST=10.77.0.1
MIKROTIK_PORT=8728
MIKROTIK_USER=openwifi
MIKROTIK_PASSWORD=SUA_SENHA
MIKROTIK_HOTSPOT_SERVER=openwifi-hotspot

PAYMENTS_MODE=mercadopago
MP_ENV=production
MP_ACCESS_TOKEN=SEU_TOKEN_COMPLETO
MP_STATUS_POLLING=true

ATTEMPT_WINDOW_MS=30000
COOLDOWN_MS=600000
MAX_ATTEMPTS=3
PIX_VALIDITY_MS=1800000

FIREBASE_ENABLED=true
FIREBASE_SITE_ID=openwifi-main
FIREBASE_SERVICE_ACCOUNT_FILE=secrets/firebase-service-account.json
```

## 6. Painéis

Local:

```text
http://localhost:8080/admin
http://10.77.0.254:8080/admin
```

Remoto:

```text
https://open-wi-fi-ofc.web.app
```

## 7. Party Mode

A troca Padrão/Party é feita pelo painel administrativo. Para Party, informe nome do evento, início e fim. Vale Night e combos vencem no fim do evento.

Dupla/Quarteto geram código aleatório de 8 caracteres, exibido como `ABCD-EFGH`. O comprador ocupa uma vaga; outro MAC do mesmo Device ID não consome nova vaga.

## 8. WhatsApp

`WHATSAPP_MODE=link` cria um link com a mensagem pronta para o comprador enviar. A exigência de informar o número no Party já é validada também no backend.

O modo `cloud-template` fica disponível para automação futura via WhatsApp Business Cloud API.

## 9. Segurança

- Nunca publique `.env`.
- Nunca publique `secrets/firebase-service-account.json`.
- Não abra a API RouterOS 8728 para a internet.
- Troque senhas fracas antes de uso real.
- Faça backup periódico de `data/store.json`.
