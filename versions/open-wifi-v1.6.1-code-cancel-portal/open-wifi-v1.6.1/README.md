# Open Wi-Fi v1.6.1 — Códigos e portal cativo

Esta versão parte da v1.6.0 e adiciona cancelamento de códigos de acesso, revogação do acesso concedido pelo código e recuperação do portal em navegadores cativos com armazenamento bloqueado. Leia [RELATORIO_V1.6.1.md](RELATORIO_V1.6.1.md) para alterações, testes e limites. Não há migration nova. A visão geral continua limitada ao estabelecimento configurado no servidor.

## Histórico da base v1.5

> **v1.5.0-command-center** — nova experiência administrativa com navegação em dois níveis, organização por áreas, busca global de ações, interface responsiva e preferências de acessibilidade. Veja `COMMAND_CENTER_V1.5.md` para o resumo completo.

## O que mudou no painel

- Command Center dividido em Central, Operação, Pessoas, Receita, Rede e Gestão;
- barra compacta para trocar de área e navegação contextual para encontrar cada função sem ruído;
- busca global por páginas e ações com `Ctrl + K` e navegação por teclado;
- perfil fixo e menu seguro, sem botão de saída sobrepondo o conteúdo;
- navegação inferior própria para celular e painel lateral adaptável para tablets;
- preferências persistentes de contraste elevado, texto ampliado e movimentos reduzidos;
- indicadores de saúde e prioridades sincronizados com a situação real da operação;
- visão geral com saúde da operação de 0 a 100;
- cards de locais, MikroTiks, visitantes, vendas, receita e acessos;
- lista automática do que precisa de atenção;
- atalhos para as ações mais usadas;
- operação do local com ticket médio, conversão, aprovação, margem e comparação com o dia anterior;
- busca e filtros para pagamentos e usuários;
- status traduzidos e estados vazios mais claros;
- atualização manual e automática sem derrubar a interface se uma seção isolada falhar;
- foco visível, salto para o conteúdo, nomes acessíveis e controle de foco em modais e menus.

## Validação local

```bash
npm install
npm run check
```

O comando confere o Worker, os scripts incorporados no painel e no portal, os IDs usados pela interface e a compilação final do pacote pelo Wrangler.

> Este repositório continua sendo um pacote de **upgrade**. As migrações começam na `0003` e pressupõem que o banco base do Open Wi-Fi já existe. Não aplique as migrações em produção sem backup do D1.

## Auto-Provisionamento MikroTik

A Fase 4 adiciona adoção/provisionamento automático de MikroTik ao Open Wi-Fi.

O fluxo passa a ser:

```text
Painel Open Wi-Fi
      ↓
Adicionar MikroTik
      ↓
Gerar bootstrap temporário
      ↓
Colar no Terminal RouterOS
      ↓
MikroTik registra identidade/modelo/versão
      ↓
Servidor entrega uma credencial individual
      ↓
RB baixa o instalador correspondente
      ↓
Configuração Open Wi-Fi
      ↓
Agente Cloud + scheduler
      ↓
ONLINE no painel
```

## Segurança do provisionamento

O script mostrado no painel contém apenas um **token de adoção temporário**:

- validade: 15 minutos;
- uso único;
- armazenado no D1 somente como SHA-256;
- é invalidado assim que uma MikroTik se registra.

Depois do cadastro, o Worker gera uma credencial permanente **exclusiva daquela MikroTik**.

Essa credencial:

- não volta para o navegador/painel;
- fica na RB no arquivo `openwifi-router.token`;
- no D1 é armazenada apenas como hash SHA-256;
- é lida pelo agente em cada poll.

A antiga `ROUTER_API_TOKEN` continua sendo aceita apenas para compatibilidade com a RB já instalada antes da Fase 4.

---

# Modos de instalação

## 1. Instalação completa

Pensada para uma MikroTik dedicada ao Open Wi-Fi ou preparada para isso.

O instalador gerencia:

- DHCP Client da WAN quando necessário;
- `bridgeLocal`;
- portas LAN escolhidas;
- interface-list `LAN` quando ela existir;
- IP LAN;
- pool DHCP;
- DHCP Server;
- DHCP Network;
- DNS remoto;
- NAT masquerade;
- HotSpot profile;
- HotSpot server;
- Walled Garden do Worker;
- login.html;
- agente Open Wi-Fi;
- scheduler a cada 10 s;
- Simple Queues dos produtos;
- bindings Cloud.

Padrão sugerido:

```text
WAN: ether1
LAN: ether2, ether3, ether4, ether5
Rede: 10.77.0.0/24
Gateway: 10.77.0.1
Pool: 10.77.0.10-10.77.0.254
HotSpot: openwifi-hotspot
```

O instalador não executa `reset-configuration`.

Ele procura objetos já existentes e atualiza/cria apenas o necessário. Nas portas LAN selecionadas, uma porta que já pertença a outra bridge será movida para `bridgeLocal` no modo completo.

## 2. Integrar HotSpot existente

Não altera:

- bridge;
- DHCP;
- IP LAN;
- NAT.

Ele utiliza o HotSpot Server informado e instala:

- Walled Garden;
- login.html no diretório HTML do profile já utilizado;
- agente Cloud;
- scheduler.

## 3. Somente agente

Não modifica rede nem captive portal.

Instala apenas:

- credencial individual;
- agente;
- scheduler;
- polling HTTPS.

É a opção recomendada para uma RB que já esteja configurada exatamente como desejado.

---

# Painel

Nova seção:

`MikroTik / Instalação`

Ela mostra:

- nome;
- ONLINE/OFFLINE;
- identity;
- board/modelo;
- RouterOS;
- modo de instalação;
- progresso;
- último contato;
- IP público.

No formulário `Adicionar MikroTik` é possível escolher o modo e gerar o script.

O script aparece em um campo grande com:

`Copiar script`

Depois basta colar o conteúdo inteiro no Terminal da RB.

---

# Processo dentro da MikroTik

O bootstrap:

1. garante WAN por DHCP no modo completo, se não houver DHCP Client;
2. coleta identity, board, RouterOS, arquitetura e serial;
3. envia os dados a `/api/router/enroll`;
4. recebe `routerId` e uma credencial individual;
5. salva a credencial em `openwifi-router.token`;
6. baixa `/api/router/installer.rsc`;
7. importa o instalador.

O instalador baixa o agente de:

`/api/router/agent.rsc`

O agente passa a executar:

`/api/router/poll`

a cada 10 segundos.

---

# Múltiplas MikroTiks

A Fase 4 prepara o backend para mais de uma MikroTik no mesmo site:

- cada RB tem token próprio;
- cada RB tem heartbeat próprio;
- hosts guardam `last_router_id`;
- uma RB não apaga hosts que foram vistos por outra;
- o total de hosts do site é agregado.

O fluxo comercial multi-estabelecimento ainda usa o `siteId` atual, mas a camada de roteadores já deixou de depender de um único token global.

---

# Desativação segura

No painel existe:

`Desativar integração`

Ela não mata a credencial imediatamente.

Fluxo:

```text
Painel
  ↓
router status = revoking
  ↓
próximo poll da RB
  ↓
Worker envia deprovision=true
  ↓
RB remove:
  - OpenWiFi Cloud bindings
  - sessões/cookies desses MACs
  - OpenWiFi Cloud Queues
  ↓
RB informa deprovisioned
  ↓
scheduler do agente é pausado
```

A configuração física de bridge/DHCP/NAT/HotSpot não é removida automaticamente, porque fazer isso remotamente poderia cortar a própria conectividade da RB.

Depois de `deprovisioned`, o cadastro pode ser excluído do painel.

---

# Atualização Cloudflare

## 1. Extraia em uma pasta nova

Não apague a versão anterior antes dos testes.

## 2. Dependências

```cmd
npm install
```

## 3. R2

Se ainda não foi criado na Fase 3B:

```cmd
npx wrangler r2 bucket create openwifi-media
```

Se já existe, pule.

## 4. Migrations

```cmd
npm run db:migrate:remote
```

Nova migration:

`0012_phase4_router_provisioning.sql`

Ela cria:

- `router_devices`;
- `router_enrollments`;
- índice de heartbeat;
- `last_router_id` em `router_hosts`.

## 5. Deploy

```cmd
npm run deploy
```

## 6. Health

Esperado:

```json
"version": "1.3.0-saas"
```

---

# Secrets

Nenhum Secret novo é necessário.

Continuam:

- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `ROUTER_API_TOKEN` — legado
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

A Fase 4 não usa `ROUTER_API_TOKEN` para novas MikroTiks.

Depois que a RB antiga também for migrada para o novo enrollment, o token global legado poderá ser aposentado em uma etapa futura.

---

# Arquivos MikroTik no ZIP

`mikrotik/openwifi-cloud-agent-phase4.rsc`

É somente uma referência do agente.

**Não é o procedimento normal de instalação.**

O procedimento oficial é:

`Painel → MikroTik / Instalação → Adicionar MikroTik → Gerar script`

O login.html e o agente são servidos dinamicamente pelo Worker.

---

# Observação importante de testes

O JavaScript do Worker e do painel pode ser validado localmente, assim como as migrations e a geração dos arquivos `.rsc`.

A execução real dos comandos RouterOS precisa ser validada em uma MikroTik física. Faça primeiro em uma RB de teste ou na RB atual com backup/export recente antes de usar em evento.


## Hotfix 1.2.1 / Fase 4.1

Corrige os problemas encontrados no primeiro teste físico com RouterOS 7.16.1:

- instalador trocado de `:onerror <var> in={} do={}` para `:do {} on-error={}`;
- JSON de telemetria de falha com escaping RouterOS correto;
- bootstrap encapsulado em `{ ... }`, permitindo colar o script inteiro diretamente no Terminal sem perder o escopo das variáveis locais;
- falha de enrollment agora interrompe o bootstrap imediatamente;
- MikroTik já adotada não precisa de novo enrollment: basta baixar novamente `/api/router/installer.rsc` usando `openwifi-router.token`.
