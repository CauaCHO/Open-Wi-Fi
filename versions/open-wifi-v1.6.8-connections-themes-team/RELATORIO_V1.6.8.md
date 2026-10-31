# Open Wi-Fi v1.6.8

## Preservado

- Worker, D1, R2, Mercado Pago, autenticação, captive portal, provisionamento e scripts da MikroTik da v1.6.7.
- Escopo de um único estabelecimento definido pelo servidor. Nenhuma troca de site foi habilitada no frontend.
- Chaves atuais de Mercado Pago no Cloudflare como fallback. Credenciais de administração e roteadores permanecem fixas no Cloudflare.

## Alterado

- Página **Conexões**: proprietário pode salvar ou restaurar a chave da API e o segredo de webhook do Mercado Pago. A chave da API é validada com o Mercado Pago antes de salvar. O segredo de webhook só pode ser confirmado quando chegar uma notificação assinada.
- Migração `0013_integration_secrets.sql`: guarda somente AES-GCM, IV aleatório e metadados. O segredo fixo `INTEGRATIONS_ENCRYPTION_KEY` deve ser configurado no Worker antes de permitir escrita. A API nunca devolve o valor das credenciais.
- Temas Grafite, Azul, Roxo e Verde; Grafite é o padrão. Escolha salva apenas no navegador.
- O cartão de rede no menu mostra o número de roteadores online, offline e desativados, sem usar alertas de vendas como cor da rede. Atualiza também enquanto outras páginas estão abertas. O diagnóstico consulta `router_devices` para o contato mais recente, com fallback legado apenas quando não há cadastro.
- Equipe: botões separados para ativar/desativar e excluir; explicação das permissões; bloqueio de exclusão e desativação da conta em uso. A conta principal continua gerenciada no Cloudflare.

## Implantação

1. Configurar `INTEGRATIONS_ENCRYPTION_KEY` como segredo do Worker, gerado aleatoriamente e mantido estável em futuras publicações.
2. Aplicar a migração `0013` no D1.
3. Publicar o Worker v1.6.8 preservando os bindings e segredos atuais.
4. Verificar `/health`, o painel, pagamentos e status das MikroTiks. Nenhuma alteração física na RB é necessária.

## Testes e limites

- Validação local do Worker, scripts embutidos do painel e portal, contratos de autorização e migrações em SQLite.
- O teste local não comprova pagamentos, webhooks, nem o funcionamento da RB em produção.
- A área Conexões só aceitará alterações depois de configurar o novo segredo fixo. Sem isso, as credenciais atuais do Cloudflare seguem em uso.
