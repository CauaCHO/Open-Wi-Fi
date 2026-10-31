# Open Wi-Fi v1.3 — SaaS Dashboard

Esta versão transforma o painel administrativo em uma experiência de **plataforma de hotspots** sem remover as funções operacionais existentes.

## O que mudou

- nova página **Visão geral** como entrada do painel;
- resumo consolidado de todos os `sites` existentes no D1;
- cards de estabelecimentos com MikroTiks, clientes, vendas, receita, acessos e modo;
- indicadores de Worker, D1, R2, Mercado Pago e webhook;
- navegação reorganizada em Plataforma, Operação, Comercial e Configuração;
- workspace atual destacado no topo;
- nomenclatura visual `Open Wi-Fi Control • SaaS`;
- área MikroTik com linguagem de infraestrutura/provisionamento;
- backend `/api/admin/platform` preparado para agregar múltiplos sites;
- compatibilidade com o `openwifi-main` atual preservada.

## Provisionamento consolidado

A v1.3 também incorpora os aprendizados do primeiro teste físico da Fase 4:

- bootstrap em bloco único, apropriado para colar no Terminal RouterOS;
- credencial individual por MikroTik;
- troca segura do agente antigo para `openwifi-cloud-poll-backup`;
- instalação do agente novo sem editar o `source` do script antigo em execução;
- scheduler configurado com `on-event="openwifi-cloud-poll"`;
- policy do scheduler: `read,write,policy,test,password,sensitive`;
- backup do agente anterior mantido para rollback.

## O que ainda NÃO está sendo vendido como pronto

A visão consolidada já lê múltiplos `sites`, mas a troca operacional de workspace entre estabelecimentos ainda não foi habilitada no painel. O botão de sites que não são o workspace atual fica desabilitado. Isso evita uma interface que aparente isolamento multi-tenant antes de todo o backend administrativo estar escopado por site.

O próximo estágio do SaaS é tornar todas as rotas administrativas site-aware e adicionar criação/edição de estabelecimentos com permissões por equipe.
