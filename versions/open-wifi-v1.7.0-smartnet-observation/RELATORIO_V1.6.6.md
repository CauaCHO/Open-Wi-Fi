# Open Wi-Fi v1.6.6 — correção do diagnóstico MikroTik

## Causa

O agente consulta o Worker a cada 10 segundos. O Worker atualizava `router_devices.last_seen_at` em toda consulta, mas exigia 30 segundos desde esse mesmo campo para atualizar `sites.router_last_seen_at` e a contagem de hosts. O prazo nunca era atingido; por isso o diagnóstico e outras telas exibiam um resumo antigo e marcavam a RB como `ATENÇÃO` mesmo com contato recente.

## Correção

- O heartbeat do roteador, os hosts e o resumo do estabelecimento passam a ser persistidos juntos no intervalo configurado de 30 segundos.
- As consultas intermediárias continuam retornando as autorizações de acesso normalmente.
- O mesmo critério por RB funciona quando há mais de um roteador no estabelecimento.
- Nenhuma alteração no script físico da RB, no esquema D1 ou nas integrações de pagamento, R2, portal e autenticação.

## Validação

- Sintaxe do Worker e 83 verificações locais de contratos, incluindo três consultas consecutivas que confirmam a gravação somente no heartbeat devido.
- Validação de JS do painel e do portal captive.
- 10 migrations de atualização validadas em base SQLite de teste inferida; os schemas originais 0001–0002 não estão no pacote.
- Empacotamento `wrangler deploy --dry-run` concluído. O Wrangler exibiu um aviso apenas ao tentar gravar seu log local.

## Publicação

- Publicada no Worker de produção após autorização específica. `/health` confirmou `1.6.6-router-heartbeat`, Mercado Pago e segredo do webhook configurados; os 20 vínculos foram mantidos na publicação.
- No heartbeat seguinte, `sites.router_last_seen_at` e `router_devices.last_seen_at` receberam exatamente o mesmo instante. A contagem de hosts do resumo foi recalculada de 3 para 2; o valor antigo estava desatualizado.
