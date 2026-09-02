# Open Wi-Fi

Plataforma de gestão de hotspots com **Cloudflare Workers + D1 + R2**, **MikroTik RouterOS** e **Mercado Pago PIX**.

## v1.3 — Open Wi-Fi Control

A branch `v1.3-saas-dashboard` inicia a evolução do painel para uma experiência de **plataforma SaaS de hotspots**: visão consolidada de estabelecimentos, MikroTiks, clientes, vendas, receita e saúde dos serviços.

Também consolida o provisionamento MikroTik a partir do primeiro teste físico: token individual por RB, bootstrap em bloco único, troca segura do agente com rollback e scheduler com as permissões corretas.

Veja [`SAAS_V1.3.md`](SAAS_V1.3.md) para o escopo da atualização.

> A seleção operacional multi-site ainda será a próxima etapa. A v1.3 já prepara a visão consolidada sem fingir isolamento multi-tenant antes de todas as rotas administrativas estarem devidamente escopadas por site.
