# Open Wi-Fi v0.8 — Mercado Pago + MikroTik + Firebase

A v0.8 mantém tudo que funcionava na v0.7 e adiciona **monitoramento remoto via Firebase**.

## Arquitetura

```text
Cliente -> ZTE/AP -> RB750Gr3 -> Internet
                     |
                     | RouterOS API
                     v
             Raspberry / notebook
             Open Wi-Fi Node.js
               |          |
               |          +-> Mercado Pago PIX
               |
               +-> Firestore (saída HTTPS)
                         |
                         v
                  Firebase Hosting
                  Dashboard remoto
                  Firebase Auth
```

O Raspberry/PC **não precisa receber conexão da internet** para o dashboard remoto. Ele inicia a conexão de saída com o Firebase e sincroniza o estado.

## Novidades v0.8

- Firebase Hosting para abrir o painel de qualquer lugar.
- Firebase Authentication com login Google.
- Firestore Security Rules protegidas por custom claim `openwifiAdmin`.
- Firestore em tempo real para dashboard.
- Agente local sincroniza métricas, clientes e compras.
- Evita regravar documentos de clientes/compras sem alteração para reduzir operações.
- Painel local `/admin` da v0.7 continua disponível como fallback.
- Mercado Pago e integração MikroTik continuam locais.

## Instalação local

```bash
npm install
copy .env.example .env   # Windows CMD
npm start
```

No Linux/Raspberry:

```bash
npm install
cp .env.example .env
npm start
```

Configure Mercado Pago e MikroTik no `.env` como nas versões anteriores.

## Firebase

Leia **`firebase/SETUP.md`**.

Resumo:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

No agente local:

```env
FIREBASE_ENABLED=true
FIREBASE_SITE_ID=openwifi-main
FIREBASE_SERVICE_ACCOUNT_FILE=secrets/firebase-service-account.json
```

Teste:

```bash
npm run firebase:check
```

Depois de fazer login uma vez no dashboard com Google:

```bash
npm run firebase:grant-admin -- seuemail@gmail.com
```

## URLs locais

Portal:

```text
http://localhost:8080
```

Painel local de fallback:

```text
http://localhost:8080/admin
```

O painel remoto será o endereço criado pelo Firebase Hosting, geralmente:

```text
https://SEU-PROJETO.web.app
```

## Segurança

Nunca publique:

- `.env`
- `MP_ACCESS_TOKEN`
- `MIKROTIK_PASSWORD`
- `secrets/firebase-service-account.json`

O objeto `firebaseConfig` do app web é identificador público do projeto; acesso aos dados é controlado por Authentication + Security Rules.

## Atualização da v0.7

Copie seu histórico:

```text
v0.7/data/store.json -> v0.8/data/store.json
```

Copie também seus valores do `.env` antigo e acrescente as variáveis Firebase.

## Firebase já configurado nesta v0.8.1

- Projeto Firebase: `open-wi-fi`
- Hosting site: `open-wi-fi-ofc`
- Deploy target: `open-wi-fi-ofc`
- Dashboard remoto esperado: `https://open-wi-fi-ofc.web.app`
- ID lógico no Firestore: `openwifi-main`

O `firebase-dashboard/firebase-config.js` já contém a configuração pública do Web App.
O `.firebaserc` já aponta para o projeto e para o site de Hosting acima.

Deploy do painel:

```bash
firebase login
firebase deploy --only hosting:open-wi-fi-ofc
```

Deploy das regras/índices do Firestore:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```
