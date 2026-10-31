# Testes — Open Wi-Fi v1.3 SaaS Dashboard

## A. Deploy

1. `npm install`
2. `npm run db:migrate:remote`
3. confirmar `0013_saas_dashboard.sql` aplicada
4. `npm run deploy`
5. `/health` deve retornar `1.3.0-saas-dashboard`

## B. Home

1. Login
2. confirmar os cinco cards: Routerboards, Receita, Dispositivos, Operação, Portal & Sistema
3. testar clique em cada card
4. testar sidebar desktop
5. testar seletor mobile
6. verificar foco por teclado e Enter nos botões/cards

## C. Routerboards

1. abrir Routerboards
2. conferir ONLINE/OFFLINE e host count
3. abrir card individual
4. renomear uma RB
5. salvar perfil
6. atualizar página e confirmar persistência
7. copiar script de reparo sem revelar token
8. testar Adicionar Routerboard

## D. Receita

1. criar uma nova compra após migration 0013
2. testar Hoje / 7 dias / mês / 30 dias / todo período
3. filtrar pela RB que originou a compra
4. conferir bruto, taxas e líquido
5. pagamentos antigos sem `router_id` devem aparecer como Não atribuído no consolidado

## E. Dispositivos

1. buscar por hostname
2. buscar por MAC
3. salvar apelido
4. confirmar apelido na tabela e modal
5. conferir coluna Routerboard
6. abrir detalhe
7. testar cortesia
8. testar encerramento de acesso

## F. Grupos e códigos

1. Dispositivos → Duplas e grupos
2. confirmar código, ocupação, status e representante
3. Dispositivos → Códigos de acesso
4. gerar código temporário
5. gerar código permanente
6. copiar e testar no captive portal

## G. Operação

1. alternar subtabs Modo e evento / Produtos e velocidade
2. salvar configuração sem perder navegação
3. testar Party Mode
4. testar pausa de vendas

## H. Portal & Sistema

1. testar upload de logo no R2
2. testar background
3. diagnóstico
4. reconciliação MP
5. permissões viewer/operator/admin
6. auditoria

## I. RB nova — teste físico posterior

Em uma RB de teste/limpa:

1. gerar Instalação completa
2. executar bootstrap uma única vez
3. confirmar bridge, DHCP, NAT, HotSpot, Walled Garden e login.html
4. confirmar agente `Open Wi-Fi Cloudflare v1.3 - SaaS Agent`
5. confirmar scheduler 10 s com `on-event=openwifi-cloud-poll`
6. confirmar ONLINE no painel
7. realizar PIX real e validar liberação/expiração
