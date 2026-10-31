# Firebase — Open Wi-Fi v0.9.2

## Pré-requisitos no Console

- Firestore criado.
- Authentication > Google habilitado.
- Domínio `open-wi-fi-ofc.web.app` autorizado.
- Service Account salva somente em `secrets/firebase-service-account.json`.
- Sua conta administrativa com custom claim `openwifiAdmin=true`.

## Comandos

```cmd
npm run firebase:login
npm run firebase:check
npm run firebase:deploy
```

Para publicar também regras e índices:

```cmd
npm run firebase:deploy:all
```

Para conceder admin:

```cmd
npm run firebase:grant-admin -- SEUEMAIL@gmail.com
```

Depois de conceder a claim, saia e entre de novo no painel.

## Party Mode

Na v0.9.2 não existe scanner de QR para combos. O convidado precisa digitar o código no portal local. O Hosting remoto é usado para monitoramento/controle administrativo, não para identificar o MAC do convidado.
