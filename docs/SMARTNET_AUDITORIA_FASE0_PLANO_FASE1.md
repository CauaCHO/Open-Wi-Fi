# Open Wi-Fi SmartNet — auditoria da Fase 0 e plano da Fase 1

Data: 04/11/2026. Base examinada: Open Wi-Fi v1.6.9, `open-wifi-v1.6.9/` e pacote correspondente em `Versões/`. Esta é uma auditoria e um plano; nenhuma configuração de RB, rota, banco ou Worker foi alterada.

## Resumo executivo

O Open Wi-Fi já tem Worker, D1, R2, portal cativo, PIX/Mercado Pago, contas administrativas, agente de polling HTTPS e cadastro individual de MikroTik. A operação por RB e um limite simples por cliente existem. O SmartNet proposto ainda não tem telemetria de capacidade, medições de QoE, motor de políticas versionadas ou coordenação de gateways. Portanto, a Fase 1 deve começar por observabilidade em modo de leitura e políticas em modo **Observação**, sem aplicar mudanças na rede.

## Inventário verificado

| Área | Estado | Evidência e limite |
| --- | --- | --- |
| Worker, D1, R2 e site atual | Implementado | `wrangler.toml` vincula `DB`, `MEDIA` e `OPENWIFI_SITE_ID=openwifi-main`. O painel e o portal estão em `src/index.js`. |
| Mercado Pago/PIX, webhook, grants e HotSpot | Implementado no código | Rotas de pagamentos e webhook, `payments`, `access_grants`, agente e portal presentes. A auditoria não repetiu uma compra real. |
| Autenticação e contas de equipe | Implementado | Cookie assinado, funções de papel, `admin_accounts` e `admin_router_permissions`. Uma conta de equipe consta no D1 de produção; login real não foi repetido nesta auditoria. |
| RB individual, contato e hosts | Implementado | `router_devices`, `router_hosts`, autenticação por hash de token e polling. D1 de produção tem um cadastro de RB. |
| Operação por RB e preset | Parcial para SmartNet | Lista de hosts e teto de download/upload por cliente já existem; preset não é um mecanismo de QoS adaptativo. Aplicação física da fila ainda depende de teste. |
| Teste de velocidade | Parcial para SmartQoE | Mede navegador ↔ Worker. Não mede por si só WAN, rádio, perda, jitter ou capacidade agregada da RB. |
| Diagnóstico | Parcial | Verifica D1, Mercado Pago, webhook e último contato de uma RB. Não identifica gargalos por segmento. |
| Auditoria | Parcial | `admin_audit` registra ações administrativas; não é um log de cada decisão, versão e confirmação de política. |
| Multiestabelecimento | Parcial/incompatível com isolamento SaaS completo | Há `sites` e `site_id` em tabelas, mas o Worker usa o site fixo `OPENWIFI_SITE_ID` em várias rotas. Não assumir isolamento de tenants. |
| Telemetria de CPU, RAM, interfaces, filas e sessões | Ausente | O agente atual envia identidade, modelo, versão, arquitetura, serial e hosts. Não há tabelas de amostras. |
| SmartQoE (latência, jitter, perda, DNS) | Ausente | Não há coleta nem séries temporais dessas medidas. |
| SmartBoost e políticas versionadas | Ausente | Existe apenas limite por plano/RB em Simple Queue; não há perfis PCQ/FQ-CoDel/CAKE, decisão, comparação ou rollback de política. |
| SmartCluster e APs | Ausente como motor | Várias RBs podem ser cadastradas, mas não há membros de cluster, capacidade por gateway, APs ou sincronização de políticas por setor. |
| Compatibilidade RouterOS 6 | Incompatível com agente atual | A adoção rejeita RouterOS 6; o agente declara RouterOS 7, com 7.16.1 como versão fisicamente validada. Não prometer suporte genérico a todas as versões 7. |

O D1 remoto contém `router_devices`, `router_hosts`, `admin_accounts` e `admin_router_permissions`; não contém `router_capabilities`, `access_points`, `telemetry`, `qoe_measurements`, `traffic_policies`, `policy_versions`, `policy_actions`, `incidents`, `cluster_members`, `experiment_runs` nem `audit_logs`. Última migration registrada: `0014_router_operations.sql`. Essa consulta foi apenas de metadados e contagens; não leu credenciais nem dados de clientes.

## Segurança e compatibilidade a resolver antes de automação

1. O agente novo usa token individual armazenado como hash no D1, mas a chave global `ROUTER_API_TOKEN` continua aceita para RBs legadas. Definir prazo e procedimento de migração, sem quebrar instalações ativas.
2. O polling atual usa Bearer token e não traz nonce/contador assinado por requisição. Um pedido capturado com token válido poderia ser repetido. Na Fase 1, telemetria e ações futuras devem ter identificação de amostra, janela temporal e deduplicação; comandos executáveis exigem confirmação e proteção própria contra replay.
3. A resposta de acesso é calculada por site e enviada a cada RB; o agente só libera MACs que vê no próprio HotSpot. Antes de SmartCluster, definir propriedade de clientes/setores e testar duplicidade de MAC, reconexão e RBs no mesmo site.
4. A RB750Gr3 não tem rádio integrado. RSSI, airtime, canal e roaming exigem AP compatível e protocolo de coleta específico; o painel deve dizer “indisponível” sem ele.
5. O `wrangler.toml` habilita logs, mas não configura traces explicitamente. Definir amostragem, retenção e descarte de dados sensíveis antes de aumentar a observabilidade.
6. Nenhum perfil de fila novo deve ser instalado até medir FastTrack, CPU, Simple Queues atuais e carga na RB de teste. A Fase 1 não toca WAN, LAN, bridge, NAT, DHCP, firewall, HotSpot, DNS nem filas.

## Backup e reversão

- O pacote imutável da v1.6.9 em `Versões/` e a cópia em `github-open-wifi/archives/` têm o mesmo SHA-256: `E1A639D6FF080BC2FC6974FA10FFF51DC23C7F3AA1ED3FC62DC33098897DEB09`. Esse é o ponto de retorno do código; guardar também o identificador da versão atual do Worker antes de qualquer publicação.
- Antes da primeira migration da Fase 1, exportar um backup privado do D1, registrar o bookmark/estado de restauração disponível e ensaiar a restauração numa base de teste. Não colocar export do D1 no GitHub, ZIP público ou logs: ele pode conter dados pessoais e financeiros.
- Migrações da Fase 1 devem ser aditivas. Para voltar atrás, reimplantar o Worker v1.6.9; tabelas novas podem permanecer sem uso. Reversão de dados só depois de ensaio e janela de manutenção.
- Agente de telemetria será opt-in, com versão antiga ainda aceita. Se falhar, desligar sua coleta sem interromper o polling atual de acesso. A última configuração local segura da RB deve continuar funcionando.

## Plano de implementação da Fase 1 — SmartNet Core

### Passo 1: contratos e modelo de dados

Arquivos previstos: `migrations/0015_smartnet_core.sql`, novos módulos em `src/` para validação/armazenamento, `scripts/` para contratos e migração, documentação de coleta. A migration deve **estender** `router_devices`/`sites`, sem duplicá-los. Criar `router_capabilities`, `router_telemetry_samples` (retenção curta), `router_telemetry_hourly`, `traffic_policies`, `policy_versions`, `policy_actions` e um log de auditoria de política com `site_id`/`router_id`, índices por tempo e chaves estrangeiras. `access_points`, `qoe_measurements`, `incidents`, `cluster_members` e `experiment_runs` pertencem às fases seguintes; só antecipar tabelas se houver fluxo real que as use.

Riscos: custo de escrita no D1, amostras sem contexto e falsa atribuição de telemetria. Dependências: esquema remoto confirmado, limites de volume e retenção, autenticação por RB. Aceite: migration aplica em base vazia e cópia de teste da base atual; esquema antigo e 118 contratos preservados; rollback do Worker ensaiado.

### Passo 2: coleta somente de leitura

Arquivos previstos: gerador do agente em `src/index.js` (ou módulo extraído), endpoint protegido versionado `/api/router/v2/telemetry`, módulos de validação e testes. Coletar inicialmente uptime, CPU, memória livre/total, contadores de interface WAN escolhida, erros quando disponíveis, total de hosts e filas Open Wi-Fi; cada campo com origem, unidade, horário de captura, versão/capacidade da RB e valor nulo quando indisponível. Limitar payload, taxa e cardinalidade. Não coletar URL visitada, conteúdo, token, senha ou serial no histórico de amostras.

Riscos: polling a cada 10 s pode aumentar carga e escrita; RouterOS 7.16.1 não garante todas as métricas em outros modelos. Começar com intervalo de telemetria maior que o polling de acesso e coletar apenas na RB de teste. Aceite: dados observados correspondem a leituras locais da RB, amostra duplicada é ignorada, versão legada segue funcionando, sem alteração no plano de dados.

### Passo 3: painel de observação e políticas sem aplicação

Arquivos previstos: APIs administrativas com verificação de `site_id`, papel e permissão por RB; painel em `src/index.js`/módulos extraídos; testes de isolamento e estados vazios. Exibir último horário, fonte, CPU, RAM, interface e tendência curta. Mostrar “indisponível” quando não houver amostra; não calcular SmartScore sem definição e cobertura suficientes. Criar versionamento de política em modo Observação, com autor, diff e trilha de auditoria. Nenhuma política é enviada à RB nesta fase.

Riscos: confundir dado antigo com estado atual e vazar RB de outra conta. Aceite: conta com RB selecionada não vê dados nem políticas de outra RB, métricas vencidas aparecem como indisponíveis, erros de coleta são distinguíveis de zero real, pagamentos e portal seguem operando.

## Critério para sair da Fase 1

Uma RB de teste transmite dados reais por período acordado; horários e unidades batem com o RouterOS; retenção funciona; painel mostra lacunas; permissões impedem acesso cruzado; agente antigo continua atendendo acessos; teste de compra e liberação, webhook, portal, autenticação e reversão passam. Só então iniciar SmartQoE. Automático permanece desativado.

## Validação desta auditoria

`node --check` passou; validação do painel passou (349 IDs, 4 scripts, 556 referências, 131 botões); 118 contratos locais passaram; teste do portal cativo passou; 14 migrations passaram em SQLite local. O build `wrangler deploy --dry-run` passou usando Wrangler 4.130.0 de `Execute`; o comando tentou escrever um log fora da área permitida e mostrou `EPERM`, sem impedir o build. `npm run check` na cópia de auditoria parou na etapa Wrangler porque ela não tem `node_modules`; as etapas anteriores passaram. Nenhum teste físico ou alteração de produção foi feito. A URL pública `/health` não pôde ser lida pela ferramenta web nesta auditoria; o estado ao vivo foi confirmado apenas pelas consultas de metadados ao D1.
