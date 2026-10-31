# Firebase — Open Wi-Fi v0.9.2

1. Mantenha Firestore + Google Authentication configurados.
2. A conta administrativa precisa ter custom claim `openwifiAdmin=true`.
3. Coloque a Service Account somente em `secrets/firebase-service-account.json`.
4. No `.env`: `FIREBASE_ENABLED=true`.
5. Coloque `newlogo.png` na raiz do projeto e rode `npm run assets:sync`.
6. Publique:

```cmd
firebase deploy --only hosting:open-wi-fi-ofc
firebase deploy --only firestore:rules,firestore:indexes
```

Ou use:

```cmd
npm run firebase:deploy
```

## Party Mode

O scanner de QR foi removido na v0.9.2. Participantes de Dupla/Quarteto entram digitando o código recebido.

Se você tinha criado a regra de Walled Garden apenas para `open-wi-fi-ofc.web.app` por causa do scanner, ela não é mais necessária para o fluxo de convidados. Você pode mantê-la ou removê-la conforme sua política de rede.

## Controle remoto

As regras permitem que admins escrevam somente em `control/desired`. O Node/Raspberry aplica a alteração. Não há acesso remoto direto à API RouterOS.
