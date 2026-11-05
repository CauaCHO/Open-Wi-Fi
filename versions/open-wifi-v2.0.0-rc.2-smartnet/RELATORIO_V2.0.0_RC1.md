# Open Wi-Fi SmartNet v2.0.0 RC.1

**Estado:** candidato local, sem publicação e sem instalação na RB. Base: v1.7.0 publicada. A migração 0016 ainda não foi aplicada ao D1 de produção.

## O que foi implementado

| Módulo | Entrega nesta candidata | O que falta para operação real |
| --- | --- | --- |
| SmartBoost | Avaliação de QoE e CPU, recomendações e política versionada | Atuador RouterOS testado, limites de segurança e validação física |
| SmartCluster | Cadastro de setor, capacidade e escolha calculada para novos clientes | Topologia e mecanismo real de seleção entre gateways |
| SmartQoE | Medição voluntária navegador–Worker, com origem e consentimento | Sondas no cliente/rede para perda IP e experiência na RB |
| Diagnóstico de gargalos | Classificação por evidência de CPU, AP, DNS e falha de requisições; incidentes | Medições de WAN e rádio para distinguir todos os gargalos |
| Otimização preditiva | Tendência simples de CPU em duas janelas | Histórico representativo, calibração e atuação preventiva |
| Priorização contextual | Contrato de classificação confiável por DSCP | Classificador validado e regras de filas testadas |
| Recuperação automática | Versionamento e restauração da política no banco | Snapshot RouterOS, aplicação transacional e rollback físico |
| Wi-Fi Airtime Intelligence | Esquema de amostras e recomendações quando houver telemetria | Adaptador ZTE compatível para rádio e clientes |
| Controle de congestionamento | Perfis candidatos PCQ, FQ-CoDel, CAKE; checagem de CPU/FastTrack | Ensaio físico de desempenho e compatibilidade antes de aplicar |
| Distribuição justa | Algoritmo de alocação respeitando limites dos planos | Conectar à demanda medida e às filas reais da RB |
| Otimização Wi-Fi | Identificação de canal ocupado por amostra de AP | Coleta e controle de canal nos APs ZTE |
| Otimização DNS | Comparação de resolvedores por origem e taxa de sucesso | Probes confiáveis na rede e configuração/rollback RouterOS |

Os status do painel refletem medições disponíveis. Sem dados, mostram indisponível ou dados insuficientes. A medição do navegador registra falhas HTTP separadamente de perda de pacotes IP. O E2320 informado pelo usuário está ligado à RB; dois ZXHN H3601P e dois H199A estão disponíveis. Todos são APs externos ao gateway e entram apenas no inventário até existir adaptador verificado. O gateway não muda rotas, filas, NAT, DNS, HotSpot nem configuração dos APs nesta candidata.

## Preservado

Worker, D1, R2, Mercado Pago, autenticação, permissões por RB, captive portal, provisionamento MikroTik e agente de observação da v1.7.0. Não há alteração no script físico de instalação da RB.

## Validação local

`npm run check` passou: sintaxe do Worker e dos scripts embutidos, 371 IDs e 606 referências de interface, 129 contratos locais, decisão com casos sintéticos, portal e compilação Wrangler `--dry-run`. `npm run validate:migrations` passou com as 16 migrações em SQLite local, integridade e chaves estrangeiras. Foi usado `XDG_CONFIG_HOME` local para os logs do Wrangler. Esses testes não substituem testes de rede, carga, equipamento ou fluxo de pagamento em produção.

## Implantação futura

Antes de publicar, guardar backup do D1, aplicar a migração 0016, publicar Worker e testar APIs com contas de cada papel. Habilitar coleta de AP, DNS, filas ou recuperação física somente depois de confirmar interface de gerenciamento e firmware dos ZTE, topologia da RB, FastTrack, limites de CPU e rollback com uma RB de teste. O modo automático de política permanece bloqueado pelo servidor.
