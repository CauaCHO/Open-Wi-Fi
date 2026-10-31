# Open Wi-Fi v1.0 Cloudflare — Fase 3A.3

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


---

## Fase 3A.1 — Desativação individual e em massa

Nova aba no painel:

`Usuários / Internet`

Ela permite:

- desativar um usuário individual;
- selecionar vários usuários com checkbox;
- `Selecionar todos` os usuários visíveis;
- desativar em massa;
- reativar individualmente;
- reativar em massa;
- registrar um motivo administrativo;
- visualizar MAC(s), e-mail, WhatsApp, último contato e fim do grant.

### Como funciona

O bloqueio é aplicado no `Device ID` lógico.

Isso significa que se o mesmo usuário tiver mais de um MAC mapeado ao mesmo Device ID,
todos deixam de ser retornados pela API `/api/router/poll`.

No próximo poll da MikroTik, o script remove os bindings `OpenWiFi Cloud`.
O corte normalmente ocorre em até aproximadamente 10 segundos.

### Importante

A suspensão administrativa:

- NÃO apaga o pagamento;
- NÃO apaga o grant;
- NÃO remove o usuário do grupo;
- NÃO devolve dinheiro;
- NÃO pausa o relógio do plano.

Se o administrador reativar o usuário enquanto o grant ainda estiver válido,
a internet volta no próximo poll.

Se o plano já tiver expirado enquanto estava bloqueado, reativar não cria tempo extra.

Essa escolha preserva histórico financeiro e evita que uma suspensão administrativa
estenda automaticamente uma compra.

### Migration

A nova migration é:

`0007_phase3a1_admin_block.sql`

Após atualizar:

```cmd
npm install
npm run db:migrate:remote
npm run deploy
```

Nenhum Secret novo é necessário.


---

## Fase 3A.2 — UX do painel e nova entrada do Captive Portal

### Painel administrativo
- paleta grafite / azul / violeta, removendo o verde anterior;
- navegação lateral no desktop;
- navegação por seletor no celular, evitando a fileira de botões;
- cards e tabelas adaptados para telas pequenas;
- modal próprio de confirmação;
- notificações próprias em formato toast;
- sem `alert()` ou `confirm()` do navegador para alterações administrativas.

### Captive Portal
A primeira tela agora mostra, tanto no modo Padrão quanto no Party:

1. **Liberar internet**
2. **Possui um código?**
3. **Conheça-nos**

`Possui um código?` aceita automaticamente:
- código administrativo;
- código de Dupla/Grupo no modo Party.

### Conheça-nos
No painel > Captive Portal agora é possível editar:
- título;
- texto da seção Conheça-nos.

### Códigos administrativos
Ao gerar o código, o administrador escolhe:
- **Por minutos**: qualquer valor a partir de 1 minuto;
- **Permanente**: sem expiração automática.

O código continua de uso único e o tempo começa a contar no momento em que ele é resgatado.

Acesso permanente continua podendo ser suspenso pela aba **Usuários e Internet**.

### Atualização

```cmd
npm install
npm run db:migrate:remote
npm run deploy
```

Migration nova:

`0008_phase3a2_ux_codes.sql`

Nenhum Secret novo é necessário.


---

# Fase 3A.3 — Temporário real de 30 s + Encerrar acesso

## 1. Correção da internet temporária

Antes:
- o Worker iniciava os 30 s no clique;
- a RB podia levar até o próximo poll para saber da autorização;
- em alguns casos o binding era criado sem `address/to-address`.

Agora:
1. o cliente solicita a janela;
2. ela fica `waitingRouter`;
3. a MikroTik faz `/api/router/poll`;
4. nesse exato poll o Worker grava `router_started_at`;
5. `starts_at = horário do poll`;
6. `ends_at = horário do poll + 30 s`;
7. só então o MAC entra em `access`.

Assim os 30 segundos contam a partir do momento em que a RB recebe a autorização,
e não mais a partir do clique do cliente.

O script MikroTik da Fase 3A.3 também copia automaticamente:
- `address`
- `to-address`

do `/ip hotspot host` para o binding `OpenWiFi Cloud`.

## IMPORTANTE: atualizar o script da RB

O Worker sozinho não corrige o binding antigo.

O arquivo atualizado está em:

`mikrotik/openwifi-cloud-poll.rsc`

NÃO substitua o seu token por um token enviado em chat.

A forma mais segura é copiar apenas a lógica nova para o script existente,
preservando o valor atual da variável `token`.

O scheduler pode continuar em 10 s.

## Teste do temporário

Após deploy e atualização do script:

```routeros
/ip hotspot ip-binding print detail where comment="OpenWiFi Cloud"
```

Ao clicar em “Liberar internet por 30 s”:

- primeiro o portal mostra `Aguardando a MikroTik`;
- no próximo poll aparece o binding Cloud;
- o contador começa em ~30 s;
- terminado o tempo, o binding é removido.

No Windows:

```cmd
npm run attempts:check
```

Você deverá ver `router_started_at` preenchido.

---

## 2. “Desativar” agora significa ENCERRAR ACESSO

Removida a semântica de bloqueio/banimento.

No painel, a ação agora é:

`Encerrar acesso`

Ela:
- revoga todo `access_grant` ativo daquele Device ID;
- cancela qualquer janela temporária ativa;
- NÃO bloqueia o aparelho;
- NÃO preserva o acesso para reativação;
- NÃO estorna o pagamento;
- NÃO devolve o código consumido.

No próximo poll, a RB remove o binding `OpenWiFi Cloud`,
derruba sessão HotSpot/cookie e o usuário volta ao captive portal.

Para ter internet de novo ele precisa:
- comprar outro plano; OU
- receber um novo código de acesso.

Um código já usado e depois revogado não pode ser usado novamente.

### Seleção em massa
Continua disponível:
- checkbox individual;
- selecionar todos;
- `Encerrar acesso selecionados`.

---

## Atualização

```cmd
npm install
npm run db:migrate:remote
npm run deploy
```

Migration nova:

`0009_phase3a3_temp_revoke.sql`

Nenhum Secret novo é necessário.
