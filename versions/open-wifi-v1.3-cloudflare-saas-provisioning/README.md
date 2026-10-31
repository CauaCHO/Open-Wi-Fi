# Open Wi-Fi Cloud v1.3 — SaaS Console + Provisionamento Seguro

Esta versão consolida os aprendizados do primeiro provisionamento físico e inicia o glow-up do painel para uma plataforma SaaS de hotspots.

## O que mudou

### Provisionamento MikroTik

O instalador agora usa uma troca segura do agente:

1. registra a MikroTik com token temporário de uso único;
2. recebe a credencial individual e salva em `openwifi-router.token`;
3. baixa o agente gerenciado;
4. cria `openwifi-cloud-poll-new`;
5. executa o agente novo antes de tocar no agente atual;
6. somente se o teste funcionar, pausa o scheduler;
7. mantém o anterior como `openwifi-cloud-poll-backup`;
8. promove o novo para `openwifi-cloud-poll`;
9. configura scheduler de 10 segundos com:
   - `on-event=openwifi-cloud-poll`;
   - `policy=read,write,policy,test,password,sensitive`;
10. executa o novo agente e conclui o status.

Esse fluxo reproduz automaticamente o procedimento que foi validado fisicamente na RB principal.

### Status automático

Um polling autenticado e saudável passa a atualizar o roteador para:

- `online`;
- `heartbeat`;
- `Agente conectado e polling ativo`.

Isso remove mensagens antigas de erro quando a RB já voltou a operar normalmente.

### Painel SaaS

O Admin agora possui uma apresentação de plataforma:

- marca `Open Wi-Fi Cloud` / `Hotspot Platform`;
- hero de operação;
- card do workspace/local atual;
- resumo de roteadores, acessos e líquido do dia;
- cards visuais da frota MikroTik;
- atalhos rápidos para roteadores, produtos e relatórios;
- linguagem visual preparada para futura camada multi-estabelecimento.

A criação real de múltiplos estabelecimentos ainda não foi ativada nesta versão; os fluxos existentes continuam usando `OPENWIFI_SITE_ID`, preservando compatibilidade e reduzindo risco.

## Atualização a partir da v1.2.1

Não há migration nova e o R2 já existente é reutilizado.

```cmd
npm install
npm run deploy
```

Depois confira:

```text
https://openwifi-api.cauaholiveira06.workers.dev/health
```

Esperado:

```json
"version": "1.3.0-saas1"
```

## RB principal já migrada

A RB principal não precisa de novo enrollment. Ela já pode continuar com a credencial individual atual.

O novo instalador é principalmente para futuras adoções e para o teste de instalação completa em uma RB separada.

## Teste recomendado para RB nova

1. backup/export da RB;
2. internet disponível na WAN;
3. Admin → MikroTik / Instalação;
4. escolher `Instalação completa`;
5. gerar bootstrap;
6. colar o bloco inteiro de uma vez no Terminal RouterOS;
7. confirmar que o painel chega a ONLINE;
8. validar bridge, DHCP, NAT, HotSpot, portal, agente e scheduler.

O bootstrap continua sem `reset-configuration`; o teste deve ser feito primeiro em equipamento separado antes de produção.
