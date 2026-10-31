# Firebase — Open Wi-Fi v0.9

1. Mantenha Firestore + Google Authentication já configurados.
2. A conta administrativa precisa ter custom claim `openwifiAdmin=true`.
3. Coloque a Service Account somente em `secrets/firebase-service-account.json`.
4. No `.env`: `FIREBASE_ENABLED=true`.
5. Publique:

```cmd
firebase deploy --only hosting:open-wi-fi-ofc
firebase deploy --only firestore:rules,firestore:indexes
```

## Scanner Party

O arquivo `scanner.html` é público de propósito: convidados ainda não autenticados precisam abrir a câmera antes de terem internet completa.

Na MikroTik:

```routeros
/ip hotspot walled-garden add server=openwifi-hotspot dst-host=open-wi-fi-ofc.web.app action=allow comment="OpenWiFi Party Scanner"
```

O scanner não lê Firestore e não possui credenciais privadas. Ele só interpreta o QR e redireciona para o portal local.

## Controle remoto

As regras permitem que admins escrevam somente em `control/desired`. O Node/Raspberry aplica a alteração. Não há acesso remoto direto à API RouterOS.
