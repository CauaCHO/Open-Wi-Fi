# Firebase — Open Wi-Fi v0.9.4

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

Na v0.9.4 não existe scanner de QR para entrar em combos. O convidado digita o código no portal local. O Hosting remoto também publica `group.html`, uma página somente de visualização do grupo por token aleatório; ela não identifica nem altera MACs.
