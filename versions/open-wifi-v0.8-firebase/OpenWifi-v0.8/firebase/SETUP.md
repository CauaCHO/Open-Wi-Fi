# Open Wi-Fi v0.8 — Firebase

O Firebase hospeda **somente o dashboard remoto**. O portal PIX e a integração MikroTik continuam no agente local (notebook/Raspberry), porque a RB 10.77.0.1 não é acessível diretamente da internet.

## 1) Criar/selecionar projeto Firebase

1. Firebase Console -> criar projeto.
2. Build -> Firestore Database -> Create database.
3. Authentication -> Sign-in method -> habilitar **Google**.
4. Configurações do projeto -> Seus apps -> adicionar um **Web app**.
5. Copiar o objeto `firebaseConfig` para `firebase-dashboard/firebase-config.js`.

O `firebaseConfig` do navegador não é uma senha; a proteção real dos dados é feita pelo Firebase Authentication + Firestore Security Rules.

## 2) Instalar Firebase CLI e conectar o projeto

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

Quando solicitado, selecione o projeto Firebase. O CLI cria `.firebaserc` localmente.

## 3) Implantar Hosting + regras

```bash
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

O painel ficará em algo como:

```text
https://SEU-PROJETO.web.app
```

## 4) Criar credencial do agente local

Firebase Console -> Configurações do projeto -> Contas de serviço -> Firebase Admin SDK -> **Gerar nova chave privada**.

Salve o JSON **somente no Raspberry/PC**, por exemplo:

```text
secrets/firebase-service-account.json
```

Nunca coloque esse arquivo em `firebase-dashboard`, GitHub ou mensagens.

No `.env` do agente:

```env
FIREBASE_ENABLED=true
FIREBASE_SITE_ID=openwifi-main
FIREBASE_SITE_NAME=Open Wi-Fi
FIREBASE_SYNC_MS=10000
FIREBASE_SERVICE_ACCOUNT_FILE=secrets/firebase-service-account.json
```

Teste:

```bash
npm run firebase:check
```

## 5) Autorizar sua conta Google como administrador

1. Abra o site do Hosting e clique em **Entrar com Google** pelo menos uma vez.
2. No agente local, execute:

```bash
npm run firebase:grant-admin -- seuemail@gmail.com
```

3. Recarregue o dashboard.

O script adiciona a **custom claim `openwifiAdmin=true`** ao usuário no Firebase Authentication. Depois do comando, saia e entre novamente no dashboard para que um novo ID token receba a claim. As regras do Firestore só permitem leitura quando essa claim está presente.

## 6) Iniciar o Open Wi-Fi

```bash
npm start
```

O terminal deve mostrar algo como:

```text
Firebase: ativado ✓ site=openwifi-main sync=10000ms
Firebase sincronizado ✓
```

## Estrutura no Firestore

```text
Firebase Auth user
  custom claim: openwifiAdmin=true

openwifi_sites/openwifi-main
  metrics
  router
  agent
  generatedAt

openwifi_sites/openwifi-main/clients/{MAC}
  hostname
  ip
  mac
  email
  plan
  online
  paidActive
  accessUntil

openwifi_sites/openwifi-main/purchases/{attemptId}
  approvedAt
  email
  hostname
  mac
  plan
  amount
  accessUntil
```

O dashboard usa listeners em tempo real do Firestore. O agente evita regravar clientes/compras que não mudaram; só o documento geral de status é atualizado a cada ciclo.
