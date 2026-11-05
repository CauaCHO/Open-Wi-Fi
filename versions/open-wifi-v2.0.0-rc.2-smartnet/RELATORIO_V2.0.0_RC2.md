# Open Wi-Fi SmartNet v2.0.0 RC.2

**Estado:** candidata local, não publicada. A RB de produção e o D1 de produção não foram alterados. A versão online continua v1.7.0.

Esta candidata mantém a estrutura dos 12 módulos da RC.1. Corrige três riscos identificados na revisão: uma mudança de perfil ou capacidade agora invalida a marca de validação física; restaurar uma versão anterior também exige nova validação; e o diagnóstico sem dados de WAN/AP informa cobertura parcial, sem declarar a rede saudável. A análise periódica encerra automaticamente o alerta de pressão de CPU somente após três amostras recentes abaixo de 70%. Leituras DNS sem sucesso não entram no cálculo de latência.

A migração 0017 e o agente de observação candidato acrescentam contadores da interface WAN, somente quando a RB possui uma rota padrão ativa única e a interface é identificável. O Worker calcula download/upload pela diferença entre duas amostras válidas e pode sinalizar uso próximo à capacidade **informada no painel**. Sem interface, duas amostras ou capacidade configurada, mostra indisponível. O bloco de coleta tem tratamento de erro para preservar o polling. A sintaxe e o comportamento desse bloco ainda exigem validação física em RouterOS 7.16.1; o agente anterior continua instalado na RB atual.

## Prontidão real

- **0 de 12 módulos completos em produção.** A RC.2 não aplica otimização automática na rede.
- **3 módulos com resultados parciais no painel:** SmartQoE (navegador para Worker), diagnóstico (CPU e falhas observadas) e tendência simples de CPU. O rollback existente restaura apenas a política no D1.
- **1 RB e 1 WAN:** SmartCluster e escolha de rota entre saídas não podem ser comprovados nessa topologia. A RB usa a internet da FEF.
- **AP E2320:** a interface local mostra clientes, banda e RSSI; o AP está em modo ponte e parece configurado para um ACS da Flash Net. Não há API autorizada para o Open Wi-Fi consultar esse ACS e não foi identificada interface local estável. Nenhuma credencial, URL de ACS, MAC, serial ou IP do AP foi incorporado ao pacote.
- **Airtime e otimização de Wi-Fi:** permanecem indisponíveis até existir adaptador autorizado para E2320/H3601P/H199A.
- **Filas, DNS, prioridade e recuperação física:** requerem atuadores RouterOS com snapshot, confirmação e rollback verificados numa RB de teste antes de habilitar.

## Preservação

Worker, D1, R2, Mercado Pago, captive portal, autenticação, permissões por RB e provisionamento MikroTik permanecem como na base v1.7.0. O script de instalação física não mudou. O agente de polling candidato contém apenas a coleta adicional de contadores WAN; não é enviado à RB até a publicação e atualização voluntária do agente.

## Validação local

`npm run check` passou: sintaxe do Worker, painel e portal, 129 contratos locais, novos casos de contadores WAN, funções de decisão e compilação Wrangler `--dry-run`. `npm run validate:migrations` passou com 17 migrações em SQLite local. Um export histórico do D1 foi restaurado somente em memória e recebeu 0015–0017 com integridade e chaves estrangeiras válidas. Testes locais não substituem testes na RB, nos APs e no caminho do provedor.
