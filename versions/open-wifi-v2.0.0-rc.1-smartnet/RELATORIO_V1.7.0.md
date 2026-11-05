# Open Wi-Fi v1.7.0 — SmartNet Observação

## O que foi preservado

Worker, D1, R2, Mercado Pago/PIX, autenticação, portal cativo, pagamentos, planos, grants, Simple Queues, agente legado e instalação da RB. Não há alteração de rotas, WAN, LAN, NAT, bridge, DNS, DHCP, firewall, HotSpot ou perfis de QoS.

## O que mudou

- O agente **gerado nesta versão** acrescenta CPU, memória e uptime ao polling HTTPS já existente. As leituras são opcionais e protegidas para não interromper a liberação se falharem.
- Migration `0015_smartnet_observation.sql`: amostras por RB com chave por minuto, índices, referências ao site/RB e tabela de capacidades preparada. Dados de amostra ficam sete dias; manutenção diária às 04:00 UTC remove registros vencidos.
- Endpoint autenticado `GET /api/admin/routers/{id}/telemetry`, com verificação da permissão por RB no servidor, limite de 60 amostras e indicação de dado recente ou antigo. Amostras fora de sete dias não aparecem.
- A guia **Operação por RB** mostra leituras reais e origem/horário; sem dados, diz que ainda não há medições. Não há SmartScore ou ganhos de velocidade presumidos.
- Uma falha de escrita da telemetria é registrada sem token e não bloqueia a resposta de acessos ao agente.

## Backup e validação

- Antes da migration, export do D1 de produção salvo em `OpenWifi/Raiz/secrets/openwifi-d1-before-smartnet-2026-11-04.sql`, fora do ZIP e GitHub. O export foi restaurado em SQLite **em memória**: `integrity_check=ok`, 26 tabelas, última migration `0014`. A `0015` também foi aplicada sobre essa restauração: `integrity_check=ok`, zero erros de chave estrangeira. Isto não equivale a um ensaio de restauração para outro D1 remoto.
- 15 migrations passaram em base SQLite nova; 120 verificações locais de contratos; testes de validação de telemetria, isolamento por RB, compatibilidade legada e falha de armazenamento; validação de interface (350 IDs), portal cativo e `wrangler deploy --dry-run` com Wrangler 4.130.0.
- O `dry-run` concluiu o build, mas o Wrangler tentou escrever seu log fora da área de trabalho e mostrou `EPERM`. Nenhum upload foi feito pelo `dry-run`.

## Ativação e reversão

1. Aplicar `0015` no D1 antes do novo Worker.
2. Publicar o Worker e confirmar `/health`, painel, portal, autenticação sem sessão, bindings e contato da RB. A RB atual continua com o agente antigo até uma atualização física autorizada.
3. Na **RB de teste** RouterOS 7.16.1, instalar o agente gerado e comparar CPU/memória/uptime do painel com `/system resource print`. Confirmar que pagamento, liberação e fila continuam funcionando. Não aplicar na rede da FEF sem autorização da equipe.
4. Para desligar a coleta, manter o agente antigo; o painel mostrará dado antigo/ausente. Para reverter o Worker, republicar a v1.6.9. A tabela `0015` pode permanecer sem uso. Para restaurar dados de produção, usar o export privado e procedimento de janela de manutenção, nunca uma reversão automática não testada.

## Ainda pendente no SmartNet 2.0

Teste físico do agente, contadores WAN/erros/filas, QoE, diagnóstico por segmento, políticas versionadas, SmartBoost, SmartCluster, APs, DNS e experimentos comparativos. Nenhum desses motores foi anunciado como ativo. Fases seguintes dependem de medições reais e critérios de aceite do plano mestre.

## Publicação confirmada em 04/11/2026

Migration `0015` aplicada no D1 de produção; Worker v1.7.0 publicado, versão Cloudflare `e6470184-5610-4732-a84d-0f638dcec516`. `/health` retornou `ok: true` e `1.7.0-smartnet-observation`; Mercado Pago e segredo do webhook constaram configurados. `/admin` e `/portal` retornaram HTTP 200; APIs administrativas sem login retornaram HTTP 401. Os 21 bindings, incluindo os seis segredos, permaneceram cadastrados. O D1 confirmou as duas novas tabelas e a única RB habilitada continuava enviando contato recente. Nenhuma amostra de telemetria física foi afirmada: a RB atual usa o agente anterior até teste e atualização explícita.
