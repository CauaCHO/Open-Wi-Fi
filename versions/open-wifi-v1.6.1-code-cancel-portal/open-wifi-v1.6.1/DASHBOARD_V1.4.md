# Open Wi-Fi v1.4 — Upgrade do painel

## Objetivo

Transformar o painel em uma central operacional: leitura rápida, prioridade clara e acesso direto às ações do dia a dia, sem remover os recursos já existentes nas versões 1.2 e 1.3.

## Nova visão geral

A página inicial agora reúne:

- saudação e resumo do dia;
- nota de saúde da operação calculada a partir dos serviços e das MikroTiks online;
- cards consolidados de locais, roteadores, visitantes, vendas, receita e acessos;
- alertas para integrações ausentes, roteadores offline, vendas pausadas e Pix pendentes;
- atalhos para gerar código, provisionar MikroTik, buscar usuário e abrir relatórios;
- cards individuais por estabelecimento, com visitantes, vendas, receita, acessos, Pix, modo e conectividade;
- situação de Worker, D1, R2, Mercado Pago e webhook.

## Operação do local

Foram adicionados indicadores de apoio à decisão:

- visitantes únicos do dia;
- ticket médio;
- conversão de visitante para venda;
- aprovação dos pagamentos;
- margem líquida depois das taxas;
- comparação de vendas e receita com o dia anterior;
- pagamentos iniciados, pendentes e com problema;
- status visual de vendas e modo de operação.

A tabela de pagamentos ganhou busca por plano, e-mail ou WhatsApp e filtros para aprovados, pendentes e cobranças com problema.

## Usuários e acesso

- busca por nome, e-mail, WhatsApp, ID ou MAC;
- filtro entre usuários com e sem acesso;
- contador de resultados;
- seleção em massa preservada ao filtrar a lista;
- estados vazios claros;
- modal com foco restaurado ao fechar;
- status de pagamentos traduzidos nos detalhes do usuário.

## Robustez e segurança

- comparações de credenciais administrativas e legadas protegidas por hash e comparação de tempo constante;
- upload e entrega de mídia por streaming, evitando carregar arquivos inteiros na memória;
- limite preventivo para imagens acima de 5 MB quando o tamanho é informado pelo servidor;
- captura central de erros não tratados com resposta JSON consistente;
- logs estruturados para facilitar diagnóstico no Cloudflare;
- carregamento tolerante a falhas: uma seção indisponível não esconde todo o painel;
- atualização automática silenciosa e atualização manual com retorno visual;
- data de compatibilidade atualizada e `nodejs_compat` habilitado;
- observabilidade do Worker habilitada no `wrangler.toml`.

## Verificação antes da publicação

Execute:

```bash
npm install
npm run check
```

O teste valida:

1. sintaxe do Worker;
2. sintaxe do JavaScript incorporado no painel e no portal;
3. IDs duplicados e referências da interface;
4. destinos de navegação, foco e acessibilidade;
5. empacotamento final do Worker pelo Wrangler, sem publicar.

## Atualização segura

1. Faça backup do D1 remoto.
2. Confira os segredos e bindings do ambiente.
3. Rode a validação local.
4. Aplique as migrações pendentes no D1.
5. Publique o Worker.
6. Teste login, venda Pix, webhook, acesso e heartbeat da MikroTik.

Nenhuma publicação nem migração remota é executada automaticamente por este pacote.

Os resultados da validação desta entrega estão em `TESTES_DASHBOARD_V1.4.md`.
