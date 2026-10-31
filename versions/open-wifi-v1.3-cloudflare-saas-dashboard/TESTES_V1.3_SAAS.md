# Testes — Open Wi-Fi v1.3 SaaS Preview

## A. Deploy

1. `npm install`
2. `npm run db:migrate:remote`
3. `npm run deploy`
4. `/health` deve mostrar `1.3.0-saas`

## B. Plataforma

1. Login como proprietário.
2. Tela inicial deve abrir em `Visão geral`.
3. Confirmar card do `openwifi-main`.
4. Confirmar métricas consolidadas.
5. Confirmar Central Operacional.

## C. Estabelecimento

1. Criar um local de teste.
2. Nome, tipo, cidade e UF.
3. Confirmar novo card.
4. Selecionar `Gerenciar local`.
5. Confirmar que o workspace muda.
6. Confirmar quatro planos padrão.
7. Editar dados do local.
8. Voltar ao workspace principal.

## D. Isolamento

No local de teste:

1. criar um plano;
2. criar um código;
3. alterar título do portal;
4. confirmar que esses dados não aparecem no workspace principal.

## E. R2 por local

1. selecionar local de teste;
2. enviar logo;
3. enviar background;
4. confirmar previews;
5. trocar para outro local;
6. confirmar que as imagens são diferentes.

## F. MikroTik atual

1. confirmar que continua ONLINE;
2. confirmar status `installed / complete`;
3. renomear para `RB Principal Open Wi-Fi`;
4. confirmar heartbeat normal.

## G. RB nova — amanhã

Faça backup/export antes do primeiro teste completo.

1. criar estabelecimento de teste ou selecionar o destino correto;
2. abrir MikroTik / Instalação;
3. criar `Instalação completa`;
4. revisar WAN, portas LAN, rede, gateway e pool;
5. gerar bootstrap;
6. executar como bloco único/script;
7. confirmar enrollment;
8. confirmar token individual;
9. confirmar bridge/DHCP/NAT/HotSpot;
10. confirmar captive portal;
11. confirmar agente candidato;
12. confirmar promoção para `openwifi-cloud-poll`;
13. confirmar scheduler 10 s;
14. confirmar ONLINE no workspace correto.

## H. Fluxo comercial

1. conectar celular;
2. abrir captive portal;
3. criar PIX;
4. pagar;
5. confirmar grant;
6. confirmar binding;
7. testar limite de velocidade;
8. esperar/revogar;
9. confirmar remoção.

## I. Party

Testar:

- evento;
- Night;
- Dupla;
- Quarteto;
- códigos;
- grupo;
- fim do evento.

## J. Equipe

1. criar admin/operator/viewer no local de teste;
2. entrar sem workspace quando username for único;
3. confirmar acesso somente ao local;
4. testar permissões;
5. se mesmo username existir em dois locais, confirmar solicitação de workspace.
