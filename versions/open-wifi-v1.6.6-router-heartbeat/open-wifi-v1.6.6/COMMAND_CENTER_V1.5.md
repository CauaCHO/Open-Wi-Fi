# Open Wi-Fi Command Center — v1.5

## Objetivo

A versão 1.5 transforma o menu administrativo em um centro de comando claro, confiável e orientado à operação. A navegação deixa de ser uma lista extensa e passa a revelar somente o contexto necessário para cada tarefa.

## Nova arquitetura de navegação

O sistema foi organizado em seis áreas permanentes:

1. **Central** — saúde geral, alertas e prioridades;
2. **Operação** — movimento do local, vendas, modos e eventos;
3. **Pessoas** — usuários, dispositivos, códigos, duplas e grupos;
4. **Receita** — produtos, velocidades, conversão e relatórios;
5. **Rede** — MikroTiks, telemetria, serviços e diagnóstico;
6. **Gestão** — portal, identidade, equipe, permissões e auditoria.

No computador, uma barra compacta seleciona a área e um segundo painel mostra apenas as páginas relacionadas. Em tablets, esse segundo painel abre como uma gaveta. No celular, as áreas mais frequentes ficam em uma navegação inferior e o restante permanece no menu **Mais**.

## Recursos de produtividade

- busca global de páginas e ações pelo botão superior ou por `Ctrl + K` / `Cmd + K`;
- pesquisa tolerante a acentos e termos relacionados, como Pix, cliente, MAC, voucher e roteador;
- navegação dos resultados pelas setas e abertura com Enter;
- atalhos operacionais na visão geral;
- breadcrumb e título atualizados conforme o contexto;
- contador de prioridades e resumo de saúde sempre visíveis;
- menu de perfil fixo, com função do usuário e encerramento de sessão;
- restrição visual e funcional das áreas conforme o papel do usuário.

## Direção visual

- base grafite e azul-marinho para transmitir estabilidade;
- ciano usado como sinal de localização e ação, não como decoração excessiva;
- superfícies em camadas, divisórias discretas e sombras controladas;
- ícones vetoriais consistentes e sem dependência externa;
- tipografia hierárquica, textos curtos e espaçamento previsível;
- estados de atenção, sucesso e falha diferenciados por texto, cor e forma.

## Acessibilidade

- link para pular diretamente ao conteúdo principal;
- foco visível em botões, links, campos e controles personalizados;
- controle de foco ao abrir e fechar navegação lateral e diálogos;
- gaveta lateral removida da ordem de teclado quando está fechada;
- nomes e relacionamentos ARIA para diálogos, busca, menus e indicadores;
- anúncio da página aberta para leitores de tela;
- preferências locais de contraste elevado, texto ampliado e redução de movimento;
- suporte automático à preferência de movimento reduzido do sistema operacional;
- controles móveis com áreas de toque maiores e rótulos legíveis.

## Estabilidade

- o Worker e as rotas existentes foram preservados;
- a visão geral continua tolerando falhas isoladas de uma seção;
- o validador estático agora confere IDs, referências, relações ARIA, destinos de navegação, áreas contextuais e nomes acessíveis de botões;
- a versão continua usando a data de compatibilidade atual do Cloudflare Workers, `2026-09-09`, com observabilidade habilitada.

## Publicação

Este pacote é uma atualização local pronta para revisão. Ele **não publica automaticamente** no Worker online e **não executa migrações remotas**. A implantação deve ser feita somente após backup do D1 e aprovação explícita.
