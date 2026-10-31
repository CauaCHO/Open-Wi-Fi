# Open Wi-Fi v0.9.4 — fluxo fechado e grupos imutáveis

Esta versão corrige o fluxo do Party Mode para não abrir aplicativos externos e adiciona acompanhamento web seguro dos grupos.

## Regras desta versão

- **Padrão:** 1h R$2, 1 dia R$5, 7 dias R$10, 30 dias R$25.
- **Party:** 1h R$2, Vale Night R$5, Dupla R$8, Quarteto R$12.
- No **Party Mode, WhatsApp é obrigatório antes de gerar qualquer PIX** e passa a ser a chave principal de recuperação da compra/grupo.
- O pagamento mostra somente **QR PIX + Copia e Cola**. Não há botão para abrir banco/instituição.
- Convites de Dupla/Quarteto são usados **somente digitando o código aleatório**. Não existe scanner de QR para entrar no grupo.
- O portal do cliente **não possui hyperlinks para banco, WhatsApp ou aplicativos externos**.
- Após criar um grupo, a tela oferece apenas **Copiar código** e um botão separado para abrir o **acompanhamento web do grupo em uma nova aba do navegador**.
- Vagas de grupo são **imutáveis**: um Device ID que entrou não pode ser excluído ou trocado durante a validade. Novos MACs do mesmo Device ID continuam na mesma vaga.
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

### Publicar painel + página de grupos + regras

```cmd
npm run firebase:deploy
```

O comando usa `npx firebase-tools`, portanto não depende de o `firebase-tools` estar instalado globalmente.

Ou dê dois cliques em:

```text
Publicar-Painel-Firebase.bat
```

### Deploy completo alternativo

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
PARTY_GROUP_VIEW_BASE_URL=https://open-wi-fi-ofc.web.app/group.html
SUPPORT_WHATSAPP=5517999999999
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

## 8. WhatsApp / recuperação

Na v0.9.4 o portal não abre WhatsApp e não envia mensagens automaticamente. O número informado no Party é normalizado e armazenado como chave de recuperação do grupo.

Se o cliente perder o código ou o link, ele pode enviar mensagem manualmente ao atendimento do Open Wi-Fi. No painel, o administrador pesquisa o mesmo número e copia o código/link correspondente.

## 9. Segurança

- Nunca publique `.env`.
- Nunca publique `secrets/firebase-service-account.json`.
- Não abra a API RouterOS 8728 para a internet.
- Troque senhas fracas antes de uso real.
- Faça backup periódico de `data/store.json`.


## 10. Grupos Party na v0.9.4

Cada Dupla/Quarteto possui:

- código aleatório curto, usado para entrar no grupo;
- `viewToken` longo e imprevisível, usado somente na URL pública de acompanhamento;
- WhatsApp normalizado do comprador como chave de recuperação;
- membros permanentes até o fim da validade;
- associação de vários MACs ao mesmo Device ID sem consumir novas vagas.

O link de acompanhamento segue este formato:

```text
https://open-wi-fi-ofc.web.app/group.html?g=TOKEN_ALEATORIO
```

A página mostra apenas informações sanitizadas: nome/hostname do aparelho quando disponível, posição no grupo, status online, horário de entrada e quantidade de MACs vinculados. **E-mail, WhatsApp e Device ID não são publicados.**

As regras do Firestore permitem somente `get` quando o token exato é conhecido; listar a coleção pública de grupos é bloqueado. Por isso, após atualizar para a v0.9.4, execute:

```cmd
npm run firebase:deploy
```

Esse comando publica Hosting, regras e índices.

### Recuperação por WhatsApp

No painel local e remoto, o administrador pode procurar o grupo pelo mesmo WhatsApp informado no momento da compra e copiar:

- código do grupo;
- link de acompanhamento.

O sistema não abre WhatsApp automaticamente. Se o cliente perder as informações, ele pode enviar mensagem manualmente ao número de suporte configurado em `SUPPORT_WHATSAPP`; o administrador usa o telefone informado como chave para localizar o grupo.

## 12. Correção do editor Padrão / Party — v0.9.4

A v0.9.4 corrige uma condição de corrida do painel administrativo. Nas versões anteriores, a atualização automática do dashboard podia receber o modo atualmente ativo (`standard`) enquanto o administrador ainda estava preenchendo um novo evento Party. O formulário era então redesenhado e voltava visualmente para Padrão antes de ser salvo.

Na v0.9.4 o painel separa dois estados:

- **Modo ativo agora**: estado confirmado pelo agente Open Wi-Fi.
- **Configuração em edição**: rascunho que o administrador está preparando.

Enquanto existir um rascunho, atualizações automáticas de clientes, vendas, MikroTik ou Firestore não alteram os campos do modo de operação. O administrador pode aplicar ou descartar as alterações manualmente.

No Firebase, após clicar em **Aplicar alterações**, o painel entra no estado **Aguardando agente…** e só considera a operação concluída quando o agente local aplica a solicitação e o Firestore confirma o estado atualizado.

Também foram adicionadas validações de início/fim do evento e feedback visual para edição não salva, salvamento e confirmação remota.
