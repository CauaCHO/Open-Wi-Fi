# Open Wi-Fi v1.3 — Hotspot Cloud / SaaS Preview

A v1.3 transforma o painel administrativo em uma base de **plataforma SaaS de hotspots**.

Ela mantém o funcionamento existente de:

- Cloudflare Workers;
- D1;
- R2;
- Mercado Pago PIX;
- captive portal;
- MikroTik;
- códigos;
- Party Mode;
- grupos;
- relatórios;
- usuários;
- equipe;
- diagnóstico.

E adiciona uma camada de **estabelecimentos/workspaces**.

---

## Novidades principais

### Visão geral da plataforma

A tela inicial agora mostra métricas consolidadas:

- locais ativos;
- MikroTiks online / total;
- usuários ativos;
- vendas do dia;
- receita bruta;
- receita líquida.

Também existe uma **Central Operacional** que destaca:

- local sem MikroTik;
- MikroTik offline;
- vendas pausadas;
- estabelecimento pausado.

### Estabelecimentos

O proprietário principal pode criar locais como:

- boate;
- evento;
- faculdade;
- restaurante;
- hotel;
- comércio;
- empresa;
- outro.

Cada local possui seu próprio workspace.

Exemplo:

```text
Open Wi-Fi Cloud
├── Open Wi-Fi Principal
│   ├── MikroTiks
│   ├── planos
│   ├── usuários
│   ├── portal
│   ├── eventos
│   └── relatórios
│
├── New House
│   ├── MikroTiks
│   ├── planos
│   ├── usuários
│   ├── portal
│   └── relatórios
│
└── Evento X
    └── ...
```

O seletor `Workspace atual` troca o local administrado.

### Novo estabelecimento

Ao criar um estabelecimento, a v1.3 também prepara os planos padrão:

- 1 hora — R$ 2
- 1 dia — R$ 5
- 1 semana — R$ 10
- 30 dias — R$ 25

Depois eles podem ser alterados normalmente na aba Produtos.

### Equipe por estabelecimento

Contas D1 continuam sendo vinculadas a um local.

No login, o campo Workspace é opcional:

- se o usuário existir em somente um estabelecimento, o sistema identifica automaticamente;
- se o mesmo username existir em mais de um local, o sistema pede o workspace.

O proprietário definido em `ADMIN_USER` / `ADMIN_PASSWORD` continua sendo o administrador global da plataforma.

### Portal e R2 por local

Logo, background e demais configurações continuam isolados por `site_id`.

Ao trocar de workspace no admin, upload e configuração de portal passam a operar sobre aquele local.

### MikroTik por local

Ao gerar uma adoção na aba MikroTik / Instalação, o enrollment é criado para o workspace selecionado.

Logo, a MikroTik adotada passa a pertencer automaticamente àquele estabelecimento.

---

# Provisionamento MikroTik v1.3

A v1.3 incorpora as correções descobertas no primeiro teste físico da RB principal.

## Melhorias

- bootstrap continua em bloco único;
- credencial permanente individual continua em `openwifi-router.token`;
- novo agente é baixado primeiro como arquivo;
- cria `openwifi-cloud-poll-new`;
- executa um smoke test do agente candidato;
- somente depois pausa o scheduler antigo;
- mantém `openwifi-cloud-poll-backup`;
- promove o candidato para `openwifi-cloud-poll`;
- scheduler fica em 10 segundos;
- scheduler usa:
  `read,write,policy,test,password,sensitive`;
- `on-event` volta ao formato comprovado:
  `openwifi-cloud-poll`;
- status final passa a:
  `installed / complete`.

O objetivo é evitar a sequência manual que foi necessária durante a depuração da primeira RB.

---

# Migration

Nova migration:

`0013_saas_platform.sql`

Ela cria `site_profiles`.

Também normaliza uma RB migrada manualmente que tenha ficado com:

`online / config / Falha durante a configuracao`

para:

`installed / complete / Agente Open Wi-Fi ativo`

quando ela já está habilitada e possui heartbeat.

---

# Atualização

Na pasta da v1.3:

```cmd
npm install
npm run db:migrate:remote
npm run deploy
```

Não recrie o R2. O bucket `openwifi-media` já existe.

Depois confira:

`/health`

Esperado:

```json
"version": "1.3.0-saas"
```

---

# Comandos úteis

Listar sites:

```cmd
npm run sites:check
```

Roteadores:

```cmd
npm run routers:check
```

Enrollments:

```cmd
npm run enrollments:check
```

Pagamentos:

```cmd
npm run payments:check
```

---

# Importante

A camada SaaS está pronta para organizar vários estabelecimentos dentro da mesma implantação do Open Wi-Fi.

Ela ainda não é uma plataforma SaaS comercial completa com:

- cadastro público de clientes;
- cobrança de mensalidade do estabelecimento;
- domínio customizado por cliente;
- tenant billing;
- recuperação automática de senha por e-mail;
- isolamento por contas Cloudflare diferentes.

Esses itens são uma etapa posterior.

A v1.3 foca no que é necessário agora: **uma única operação Open Wi-Fi administrando vários hotspots de forma organizada e isolada por site**.
