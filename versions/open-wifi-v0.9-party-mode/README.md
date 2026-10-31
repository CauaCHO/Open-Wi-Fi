# Open Wi-Fi v0.9 — Party Mode

A v0.9 mantém todo o fluxo da v0.8.2 (PIX Mercado Pago, MikroTik por MAC, Device ID lógico, Firebase e painel local) e adiciona um modo de operação específico para festas.

## Modos

### Padrão
- 1 hora — R$ 2
- 1 dia — R$ 5
- 1 semana — R$ 10
- 30 dias — R$ 25

### Party
- 1 hora — R$ 2
- Vale Night — R$ 5 (até o fim do evento)
- Combo Dupla — R$ 8 (2 Device IDs até o fim do evento)
- Quarteto — R$ 12 (4 Device IDs até o fim do evento)

O horário do evento é definido pelo dashboard. Quando o evento termina, o modo volta automaticamente para Padrão; os bindings pagos também expiram pelo reconciliador da MikroTik.

## Combos

Ao aprovar Dupla/Quarteto, o backend:
1. cria um código criptograficamente aleatório como `Q7K2-P9XM`;
2. checa se o código já existe;
3. cria um token de convite longo e imprevisível;
4. gera um QR que aponta para `PARTY_INVITE_BASE_URL?invite=...`;
5. vincula o comprador como a primeira vaga;
6. guarda o WhatsApp e o convite no `store.json`;
7. permite reenvio pelo painel.

Um Device ID lógico pode ter vários MACs. Trocar 2.4/5 GHz e ganhar outro MAC privado não consome outra vaga se o navegador ainda possuir o token lógico do Open Wi-Fi.

## Scanner pela câmera

`firebase-dashboard/scanner.html` é público e HTTPS no Firebase Hosting. O botão **Escanear QR** do captive portal abre essa página, que usa a câmera traseira e `BarcodeDetector`. Ao ler o convite, o scanner redireciona de volta ao `join.html` local.

Depois de publicar a v0.9, libere o scanner no Walled Garden da RB:

```routeros
/ip hotspot walled-garden add server=openwifi-hotspot dst-host=open-wi-fi-ofc.web.app action=allow comment="OpenWiFi Party Scanner"
```

Se o navegador não oferecer leitura QR ao vivo, a tela oferece captura de uma foto do QR e sempre mantém a opção de digitar o código.

## WhatsApp

Dois modos:

### `WHATSAPP_MODE=link`
Não precisa Meta API. O convite fica salvo e a tela mostra **Enviar pelo WhatsApp**, abrindo `wa.me` com código, evento, validade e link preparados. O QR continua visível na tela e no painel.

### `WHATSAPP_MODE=cloud-template`
Envia automaticamente pelo WhatsApp Cloud API. O código envia o QR como imagem no cabeçalho de um template aprovado.

Variáveis:

```env
WHATSAPP_MODE=cloud-template
WHATSAPP_GRAPH_VERSION=v26.0
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_TEMPLATE_NAME=openwifi_party_invite
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
```

O template `openwifi_party_invite` deve possuir:
- cabeçalho de mídia: **Imagem**;
- corpo com quatro variáveis, nesta ordem: código, nome do evento, validade, link do convite.

Se o envio automático falhar, o sistema não perde o combo: salva o erro e mantém o link manual de compartilhamento.

## Atualizar da v0.8.2

Copie para a v0.9:

```text
.env
data/store.json
secrets/firebase-service-account.json
```

Depois acrescente ao `.env`:

```env
PARTY_INVITE_BASE_URL=http://10.77.0.254:8080/join.html
PARTY_SCANNER_URL=https://open-wi-fi-ofc.web.app/scanner.html
WHATSAPP_MODE=link
WHATSAPP_GRAPH_VERSION=v26.0
```

Instale e valide:

```cmd
npm install
npm run check
npm start
```

## Firebase v0.9

O painel remoto agora também mostra Party Mode, evento e combos. Uma conta com `openwifiAdmin=true` pode solicitar remotamente a troca Padrão/Party. O dashboard escreve apenas em:

```text
openwifi_sites/openwifi-main/control/desired
```

O agente local lê o pedido, valida horário/evento, aplica no `store.json` e sincroniza o resultado. O navegador remoto nunca fala diretamente com a MikroTik.

Publique novamente Hosting + regras:

```cmd
firebase deploy --only hosting:open-wi-fi-ofc
firebase deploy --only firestore:rules,firestore:indexes
```

## URLs

Local:
- Portal: `http://10.77.0.254:8080/`
- Entrar em combo: `http://10.77.0.254:8080/join.html`
- Dashboard local: `http://10.77.0.254:8080/admin`

Remoto:
- Dashboard: `https://open-wi-fi-ofc.web.app`
- Scanner: `https://open-wi-fi-ofc.web.app/scanner.html`

## Observações de segurança

- Não coloque `MP_ACCESS_TOKEN`, senha MikroTik, `WHATSAPP_ACCESS_TOKEN` ou Service Account no Firebase Hosting.
- `secrets/*.json`, `.env` e `data/store.json` estão no `.gitignore`.
- API RouterOS deve permanecer limitada ao IP do agente local.
- O WhatsApp completo fica local; o dashboard/Firebase recebe apenas a versão mascarada.
