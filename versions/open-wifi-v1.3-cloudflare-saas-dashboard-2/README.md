# Open Wi-Fi v1.3 — SaaS Dashboard

A v1.3 reorganiza o painel do Open Wi-Fi como uma central de operação de hotspots, reduzindo a poluição visual e agrupando as funções por contexto de trabalho.

## Nova home

Ao entrar no painel, a primeira tela agora prioriza cinco áreas:

- **Routerboards** — RBs vinculadas, status, clientes, perfil e provisionamento.
- **Receita** — faturamento, taxas, líquido, vendas e filtro por Routerboard.
- **Dispositivos** — aparelhos, apelidos, acessos, grupos/duplas e códigos.
- **Operação** — modo Padrão/Party, evento, produtos e velocidade.
- **Portal & Sistema** — identidade visual, LGPD, diagnóstico, equipe e auditoria.

A navegação lateral foi reduzida para essas áreas principais. Funções relacionadas aparecem como subtabs dentro de cada área.

## Routerboards

A lista antiga em formato de tabela virou cards de Routerboard. Cada card mostra:

- ONLINE/OFFLINE;
- modelo e RouterOS;
- clientes vistos naquela RB;
- modo de instalação;
- IP público;
- último contato.

Ao abrir uma Routerboard é possível editar o **perfil gerenciado**:

- nome;
- modo (`full`, `hotspot`, `agent`);
- WAN;
- portas LAN;
- HotSpot Server;
- rede;
- gateway;
- pool DHCP.

O botão **Copiar script de reparo** gera um comando que usa a credencial individual já armazenada na RB para baixar e reaplicar o instalador atual. A senha/token individual não é exposta no painel.

### Provisionamento mais robusto

O instalador v1.3 incorpora o que foi aprendido no primeiro teste físico:

- não tenta mais substituir o `source` do agente antigo diretamente;
- desativa o scheduler durante a troca;
- renomeia o agente anterior para `openwifi-cloud-poll-backup-auto`;
- cria o agente novo primeiro com `read,write,test`;
- amplia depois para `read,write,policy,test,password,sensitive`;
- configura o scheduler com `on-event="openwifi-cloud-poll"`;
- scheduler permanece em 10 segundos.

O objetivo para uma RB nova continua sendo: **gerar script → colar uma vez → provisionar → ONLINE**. O modo completo ainda deve ser validado numa Routerboard limpa antes de uso comercial.

## Receita

Nova API:

`GET /api/admin/revenue`

Filtros:

- hoje;
- últimos 7 dias;
- este mês;
- últimos 30 dias;
- todo o período;
- Routerboard específica.

Métricas:

- bruto;
- taxas;
- líquido;
- vendas;
- ticket médio;
- receita por dia;
- resultado por Routerboard.

### Atribuição por RB

A migration `0013_saas_dashboard.sql` adiciona `router_id` aos pagamentos.

Novas compras passam a registrar a Routerboard que viu o MAC no momento da criação do PIX. Pagamentos antigos permanecem como **Não atribuído** em vez de receber uma atribuição histórica potencialmente incorreta.

## Dispositivos

A área Dispositivos agora reúne três subtabs:

1. Dispositivos
2. Duplas e grupos
3. Códigos de acesso

Foi adicionado `admin_alias` aos dispositivos. É possível apelidar um aparelho, por exemplo:

- Caixa Bar
- Tablet Entrada
- Celular João

A tabela mostra também a Routerboard onde o MAC foi visto. O detalhe do dispositivo mantém MACs, IP, pagamentos, grants, tentativas, cortesia e encerramento de acesso.

## Operação

Subtabs:

- Modo e evento
- Produtos e velocidade

Mantém toda a lógica Padrão/Party e o controle de vendas existente.

## Portal & Sistema

Subtabs:

- Portal e marca
- Diagnóstico
- Equipe
- Auditoria

O upload R2, avisos, LGPD, Mercado Pago, reconciliação e permissões continuam disponíveis.

## Migration v1.3

Nova migration:

`migrations/0013_saas_dashboard.sql`

Ela adiciona:

- `devices.admin_alias`
- `payments.router_id`
- índices para receita por RB e busca administrativa.

## Atualização

Na pasta da v1.3:

```cmd
npm install
npm run db:migrate:remote
npm run deploy
```

Não é necessário recriar o bucket R2.

Depois confira:

`/health`

Versão esperada:

```json
"version": "1.3.0-saas-dashboard"
```

## Segurança

- tokens individuais das Routerboards continuam fora do navegador;
- o painel não retorna `token_hash`;
- token de enrollment continua temporário e de uso único;
- apelidos são apenas metadados administrativos;
- ações de configuração permanecem protegidas por role.

## Observação

Esta versão melhora significativamente o painel e prepara a operação multi-RB. Ela **não transforma ainda `site_id` em um multi-tenant completo com vários estabelecimentos independentes na mesma conta**. Essa é uma evolução posterior; a v1.3 organiza a experiência como SaaS sem fingir que a separação multi-site já está concluída.
