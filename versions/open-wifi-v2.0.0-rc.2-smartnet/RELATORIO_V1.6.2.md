# Open Wi-Fi v1.6.2 — relatório curto

## Diagnóstico

A CHO-Gateway é uma hEX com RouterOS 6.49.13. O Cloudflare registrou uma chamada bem-sucedida a `/api/router/enroll`, mas nenhuma chamada posterior a `/api/router/installer.rsc`, `/api/router/agent.rsc` ou `/api/router/install-status`. Na RB, não há arquivo de credencial, instalador, agente ou agendador. O script atual usa `:deserialize` para JSON, disponível no RouterOS 7. O cadastro ocorreu antes da primeira chamada incompatível.

## Preservado

Todos os recursos da v1.6.1, Worker, D1, R2, Mercado Pago, captive portal, autenticação e fluxos de RouterOS 7. Nenhuma configuração física da RB foi alterada e não há migration nova.

## Alterado

- O bootstrap verifica a versão do RouterOS antes de alterar a WAN ou chamar o servidor; em RouterOS 6, mostra uma mensagem clara e interrompe a execução.
- O servidor também rejeita o cadastro de RouterOS 6 sem criar roteador, token permanente ou registro enganoso no painel.
- A lista de roteadores marca as versões 6 como incompatíveis e o formulário informa o requisito de RouterOS 7. O agente foi validado na linha 7.16.1.

## Validado

Sintaxe do Worker e scripts HTML, 76 contratos locais incluindo rejeição sem gravação, interface, portal cativo com armazenamento bloqueado, migrations existentes em SQLite e compilação Wrangler `--dry-run`.

Publicado no Worker `openwifi-api` em 2026-10-30 UTC. O `/health` público respondeu com `1.6.2-routeros-version-guard`; os 20 vínculos, incluindo D1, R2 e segredos, permaneceram presentes.

## Pendente

- Atualizar a CHO-Gateway para RouterOS 7 em uma janela apropriada, com backup e acesso local disponíveis. Depois, gerar um novo script em **Somente agente**, pois o HotSpot `hotspot-cho` já existe. O token de inscrição antigo foi consumido e não deve ser reutilizado.
- Confirmar heartbeat, hosts e liberação em celulares reais após a atualização.
