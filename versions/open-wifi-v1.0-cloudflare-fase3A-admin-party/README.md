# Open Wi-Fi v1.0 Cloudflare — Fase 3A

Esta versão mantém o Pix, D1, MikroTik, webhook e anti-abuso da Fase 2B e adiciona o painel administrativo e o Party Mode.

## Painel
Abra:
`https://openwifi-api.cauaholiveira06.workers.dev/admin`

Recursos:
- RB online/offline e quantidade de clientes
- vendas e receita do dia
- acessos ativos e Pix pendentes
- pagamentos recentes com e-mail e WhatsApp
- alternar Padrão / Party
- pausar vendas
- nome/início/fim do evento
- CRUD de produtos/preços
- background sem imagem ou com URL HTTPS
- WhatsApp de suporte
- exigir WhatsApp no Padrão opcionalmente
- códigos únicos de acesso
- grupos Party com ocupação e link do representante
- busca de grupos por WhatsApp
- auditoria

## Código de acesso
- Padrão: 24h
- Party: até o fim do evento
- uso único

## Dupla / Grupo
Planos Party com `max_devices > 1` criam:
- código do grupo
- primeiro slot para o comprador
- link público somente leitura
- participantes entram pelo código
- membros não têm remoção pelo portal/admin nesta fase

## Instalação

```cmd
npm install
npm run db:migrate:remote
```

A migration nova é:
`0006_phase3a_admin_party.sql`

Crie os dois Secrets do painel:

```cmd
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
```

Para gerar o segundo no PowerShell:

```powershell
[Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Maximum 256 }))
```

Mantenha os Secrets já existentes:
- ROUTER_API_TOKEN
- MP_ACCESS_TOKEN
- MP_WEBHOOK_SECRET

Depois:

```cmd
npm run deploy
```

Confirme em `/health`:
`"version": "1.0.0-phase3A"`

Usuário padrão do painel:
`admin`

## Configuração Party sugerida
No painel:
- crie/salve o evento
- mude modo para Party
- Vale Night: `max_devices=1`, `até o fim do evento`
- Dupla: `max_devices=2`, `até o fim do evento`
- Quarteto: `max_devices=4`, `até o fim do evento`

## Background
Nesta versão a imagem é configurada por URL HTTPS.
Não armazenei imagem grande dentro do D1.

## Próximas melhorias já planejadas
- upload de background via Cloudflare R2
- exportação CSV
- gráfico por hora
- taxa Mercado Pago e lucro líquido
- relatório pós-evento
- operadores com permissões
- limite de velocidade por plano
- bloqueio emergencial de aparelho
- múltiplos locais/sites
