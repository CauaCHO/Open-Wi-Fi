# Open Wi-Fi v1.5.1

Revisão local baseada no pacote **open-wifi-v1.5-command-center-upgrade.zip**, com foco no painel SaaS solicitado. O nome v1.5.1 foi confirmado pelo usuário para preservar o histórico. Nenhuma publicação ou operação na RB foi realizada.

## Auditoria e correções

A base já continha as versões 1.3, 1.4 e 1.5, navegação por áreas, relatórios, gestão de equipe e provisionamento consolidado. A revisão encontrou e corrigiu:

- **Consulta entre estabelecimentos:** `/api/admin/platform` agregava todos os locais para qualquer perfil autorizado. Agora suas oito consultas usam o estabelecimento configurado no servidor. Parâmetros de URL não trocam esse contexto.
- **Indicadores ambíguos:** removidos o score de saúde com pesos arbitrários e as barras decorativas de progresso. O painel distingue sinal do roteador, hosts reportados, permissões de acesso, pagamentos e taxas registradas.
- **Roteador desativado:** contato recente não basta para classificá-lo como online. Equipamentos desativados ficam separados dos offline.
- **Atualizações com falso sucesso:** falhas ficam visíveis, com nova tentativa e identificação de dados antigos. A mensagem de sucesso depende da consulta concluída.
- **Conteúdo dinâmico em ações de tabela:** removidos os nove handlers HTML que interpolavam identificadores. Ações usam valores escapados e delegação de eventos, inclusive para IDs contendo aspas/HTML.
- **Permissões visuais:** a atualização da operação não volta a exibir o botão de pausa de vendas para o perfil somente leitura.
- **Identificação da versão:** `/health` agora informa `1.5.1-saas-control`, permitindo conferir a versão publicada sem autenticação.

## O que mudou na interface

Paleta Dark Tech Premium, superfícies mais discretas, hierarquia tipográfica e foco visível; preservação da navegação agrupada e da busca por páginas/ações; nova área **Estabelecimento**, com contexto atual e troca indisponível; visão de rede por contatos reais; filtros de roteadores; conexão e instalação em colunas distintas; instruções de provisionamento mais precisas; estados de carregamento, vazio e erro; carga das páginas sob demanda e atualização automática sem sobreposição, suspensa quando a aba está oculta. As fontes usam uma pilha local com fallback do sistema, sem serviço externo obrigatório.

Os componentes reaproveitados incluem tabelas, gráficos, confirmações, notificações e formulários existentes. Foram acrescentados componentes comuns de estado de carregamento, indicadores com definição explícita e resumo de rede.

## Preservado

Autenticação e autorização no servidor; cobrança PIX, confirmação e reconciliação Mercado Pago; D1 e R2; planos e velocidades; códigos, cortesia, Party e grupos; relatórios e auditoria; personalização e upload do portal; captive portal e página de grupos; comunicação, adoção, liberação e revogação MikroTik.

O gerador, agente e scheduler da base foram mantidos: token individual, backup do agente, intervalo de 10 s, `on-event="openwifi-cloud-poll"` e policies existentes. Não houve alteração de configuração física de rede. A comparação de preservação está em `PRESERVACAO.json`.

## Banco e APIs

**Nenhuma migration nova.** As dez migrations recebidas foram preservadas. As mudanças de backend se limitam a `adminPlatform` e `adminRouters`: filtro do local, estado online, contagens de desativados/offline e metadados de contexto/tempo. Não há multi-tenancy completo: autenticação, planos, vendas e administração continuam operando no local configurado por instância. O seletor permanece desabilitado.

## Validação realizada

- `npm run check`: sintaxe do Worker, JS do painel/portal, referências HTML e empacotamento Wrangler em `--dry-run`, aprovados.
- **71 verificações locais** de contratos: sessões, papéis, proteção de rotas, dois contextos configurados, isolamento da visão geral e estados de heartbeat. D1 simulado; nenhuma API real chamada.
- **10 migrations** executadas em SQLite sobre fixture mínima **inferida**, com verificações de integridade, chaves e restrições. O pacote não contém as migrations 0001/0002; instalação limpa e schema de produção não foram validados.
- Navegador: os **14 módulos em nove larguras** (320, 360, 375, 390, 430, 768, 1024, 1440 e 1920 px), sem overflow horizontal da página nos 126 casos. Tabelas mantêm rolagem interna.
- Navegação móvel, busca e teclado, filtros de roteadores, modos de instalação, estados vazio/carregando/erro, recuperação por nova tentativa, perfil somente leitura e conteúdo com aspas/HTML testados com fixtures identificadas como teste. Sem erros de console observados nesses cenários.

## Pendências

Teste em RB limpa, estabilidade prolongada, filas físicas e fluxo real PIX → liberação → expiração; ensaios reais de R2/webhook e captive Android/iOS; multiestabelecimento com vínculo de contas e autorização por local em todas as rotas; identidade segura de dispositivo; receita mensal, séries históricas de sessões e comparação entre locais quando houver contratos/dados adequados. As taxas exibidas são as registradas no banco, não uma confirmação de repasse.

Landing page institucional, novo editor visual do portal e redesign amplo do captive ficam para a próxima etapa: esta entrega prioriza o painel e preserva esses fluxos. A revisão não certifica acessibilidade integral nem execução comercial em produção.

## Como revisar

Em um ambiente com Node e Python: `npm ci`, `npm run check`, `npm run validate:migrations`. Para a prévia isolada: `npm run preview:qa` e abra `http://127.0.0.1:4173/admin`. A prévia tem dados sintéticos, recusa gravações administrativas e não se conecta à produção.

Para atualizar uma instalação existente, preserve os bindings e secrets atuais. Esta revisão não pede migração nova. O deploy deve ser realizado separadamente, após revisão e backup do ambiente existente.
