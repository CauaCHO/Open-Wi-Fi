# Open Wi-Fi v0.9.2

## Alterações desta versão

- Party Mode exige **WhatsApp válido para qualquer plano antes de gerar o PIX**.
- Removidos os atalhos para abrir bancos/instituições. O pagamento fica com **QR PIX + Copia e Cola**.
- Removido o scanner de QR de convite. **Dupla/Quarteto entram somente digitando o código**.
- Depois da aprovação do PIX, o Open Wi-Fi **não redireciona nem fecha a página**. A tela permanece em “Pagamento aprovado” até o usuário sair por conta própria.
- Combos continuam gerando código aleatório exclusivo e podem enviar/reencaminhar o código pelo WhatsApp.
- `newlogo.png` é usado no portal, painel local, painel Firebase e favicon.

## Colocar a sua logo

Copie sua imagem com o nome exato:

```text
newlogo.png
```

para a **raiz do projeto**, ao lado de `package.json` e `.env`:

```text
OpenWifi-v0.9.2/
├── newlogo.png
├── package.json
├── .env
├── public/
└── firebase-dashboard/
```

Ao executar `npm start`, a v0.9.2 copia automaticamente a logo para `public/newlogo.png` e `firebase-dashboard/newlogo.png`.

Antes de publicar o painel remoto, você pode executar:

```cmd
npm run assets:sync
firebase deploy --only hosting:open-wi-fi-ofc
```

ou simplesmente:

```cmd
npm run firebase:deploy
```

## Atualizar da v0.9.1

Copie para a nova pasta:

```text
.env
data/store.json
secrets/firebase-service-account.json
newlogo.png
```

Depois:

```cmd
npm install
npm start
```

Se usa Firebase Hosting, publique novamente:

```cmd
npm run firebase:deploy
```

## Party Mode

Planos padrão do Party:

- 1 hora — R$ 2
- Vale Night — R$ 5
- Combo Dupla — R$ 8
- Quarteto — R$ 12

Enquanto Party estiver ativo, o backend rejeita a criação do PIX sem WhatsApp válido.

Nos combos, após o pagamento o comprador recebe um código aleatório como `K7PM-X4RT`. Os demais aparelhos conectam no Open Wi-Fi, entram em **Entrar em um combo** e digitam esse código.

## Observação sobre a tela após pagamento

O código da v0.9.2 não chama `window.close`, não abre banco e não redireciona para outro site após a aprovação. Alguns sistemas Android/iOS podem fechar a janela própria de captive portal automaticamente quando detectam que a internet foi liberada; isso é comportamento do sistema operacional e não pode ser garantidamente bloqueado pela página web.
