# Open Wi-Fi v1.6.9

## Preservado

- Cloudflare Worker, D1, R2, Mercado Pago, autenticação, portal captive e scripts de instalação da MikroTik.
- Credenciais, bindings, site atual e conta principal. A migração não muda as configurações existentes de nenhuma RB.

## Alterado

- **Equipe:** PBKDF2 reduzido de 210.000 para 100.000 iterações, limite aceito pelo Worker segundo o erro real registrado no Cloudflare na tentativa de 31/10/2026. O erro 1101 foi causado por `Pbkdf2 failed: iteration counts above 100000 are not supported`. Senha curta, nome de usuário inválido e duplicado agora recebem respostas claras. O painel não mostra HTML bruto de erro do Cloudflare.
- **Permissão por RB:** tabela `admin_router_permissions` e modo `selected` por conta. Contas restritas só podem consultar RBs atribuídas e seus hosts. APIs gerais de vendas, clientes e configuração são bloqueadas no servidor. A permissão de edição exige papel Operador/Administrador e a marcação Alterar para a RB.
- **Operação por RB:** seletor de RB, contato, hosts recentes, preset de limite máximo de download/upload por cliente. O agente já instalado aplica esse limite às filas do Open Wi-Fi no próximo poll; o limite menor do plano prevalece. Não altera NAT, rotas, bridge ou HotSpot.
- **Teste de conexão:** mede download e upload entre o navegador que abriu o painel e o Worker. Para incluir a RB no caminho, o dispositivo precisa estar conectado ao Wi-Fi dela. O resultado não mede a capacidade total da RB.

## Validação

- Sintaxe do Worker, scripts embutidos do painel e portal, 118 verificações locais de contrato, 14 migrações em SQLite e `wrangler deploy --dry-run`.
- Foram testados o isolamento de uma conta restrita, o teto de velocidade por RB e a criação de conta com 100.000 iterações.
- Pendentes: publicação no Cloudflare, migração remota, criação de uma conta real no painel e teste físico do preset na RB.

## Roteamento de internet

Com uma única saída WAN, a RB controla sua rota até o gateway do provedor, mas não escolhe o caminho completo até cada site. Uma seleção real entre caminhos exige mais de uma conexão WAN e critérios de medição e failover. Esta versão não altera as rotas da RB.
