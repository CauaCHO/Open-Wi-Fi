# Testes v1.3 — Open Wi-Fi Cloud

## A. Deploy

- `npm install`
- `npm run deploy`
- `/health` = `1.3.0-saas1`
- Admin abre normalmente
- PIX, planos, usuários e portal permanecem disponíveis

## B. Painel SaaS

- título `Open Wi-Fi Cloud`
- hero `Hotspot Platform`
- workspace atual mostra nome/modo
- resumo mostra roteadores, acessos e líquido do dia
- aba MikroTik renderiza cards da frota

## C. RB já adotada

- não gerar novo enrollment
- confirmar `openwifi-router.token` > 0
- confirmar scheduler 10 s
- confirmar painel ONLINE
- polling saudável deve limpar mensagem de falha antiga para `online / heartbeat`

## D. Nova RB — Somente agente

- gerar script
- colar o bloco inteiro no Terminal
- confirmar `openwifi-cloud-poll-new` durante teste
- ao concluir, confirmar `openwifi-cloud-poll`
- confirmar `openwifi-cloud-poll-backup` somente se havia agente anterior
- scheduler deve usar `on-event=openwifi-cloud-poll`
- scheduler policy deve ser `read,write,policy,test,password,sensitive`

## E. Nova RB — Instalação completa

Validar fisicamente antes de produção:

- WAN DHCP/internet
- bridgeLocal
- portas LAN
- interface-list LAN
- IP LAN
- pool/DHCP
- DNS
- NAT
- profile HotSpot
- HotSpot server
- Walled Garden
- login.html
- token individual
- agente gerenciado
- scheduler 10 s
- painel ONLINE

## F. Fluxo comercial pós-instalação

- portal captive
- tentativa temporária 30 s
- PIX real
- grant
- binding Cloud
- velocidade por plano
- expiração/revogação
- Party / grupos / códigos / cortesia
