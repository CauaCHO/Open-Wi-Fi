# Open Wi-Fi v1.6.7 — segurança do instalador MikroTik

## Alterações

- O agente gerado usa o nome de HotSpot escolhido no painel, nos modos completo, HotSpot existente e somente agente.
- O painel pede o nome do HotSpot também em “Somente agente” e apresenta mensagens claras para configurações rejeitadas.
- O modo completo rejeita WAN igual a LAN, rede/gateway/faixa DHCP incompatíveis e nomes de portas inválidos. O instalador verifica a existência das interfaces e impede usar uma WAN já colocada em bridge antes de alterar a configuração.
- O instalador verifica se o HotSpot informado existe, valida a sintaxe do novo agente e o prepara como candidato antes da troca. Se a ativação falhar, tenta restaurar o agente e o scheduler anteriores.
- Falhas de instalação registram a etapa no log da RB e no painel sem enviar a credencial.
- As migrações originais `0001_initial.sql` e `0002_seed_default.sql` foram recuperadas do ZIP v1.0 e adicionadas sem alterar as migrações `0003`–`0012`.

## Preservação e limites

- Worker, D1, R2, Mercado Pago, portal captive, autenticação, pagamentos e código de acesso foram preservados. Nenhuma migração ou mudança física automática foi adicionada.
- O teste local valida estrutura e contratos dos scripts gerados, mas não executa RouterOS. Os três modos precisam ser testados em uma RB de teste antes de adoção ampla.
- A sequência completa foi validada em SQLite local, mas uma instalação D1 do zero ainda não foi validada. O backend administrativo segue restrito ao estabelecimento configurado.

## Validação

- `node --check src/index.js`
- `node scripts/validate-dashboard.mjs`
- `node scripts/validate-contracts.mjs` (94 verificações)
- `node scripts/validate-portal-captive.mjs`
- `python scripts/validate-migrations.py` (12 migrações em banco SQLite vazio)
- Empacotamento `wrangler deploy --dry-run` concluído com Wrangler 4.130.0; apareceu apenas um aviso ao gravar o log global local.
