# Testes — Open Wi-Fi Fase 4

## A. Cloudflare

1. `npm install`
2. `npm run db:migrate:remote`
3. `npm run deploy`
4. `/health` deve mostrar `1.2.0-phase4`
5. entrar no Admin
6. abrir `MikroTik / Instalação`

## B. Geração

1. Nome: `RB Teste`
2. Instalação: `Somente agente`
3. Gerar script
4. confirmar prazo de 15 minutos
5. copiar
6. atualizar página
7. observar enrollment pendente; o token em texto não deve ser recuperável novamente

## C. Adoção — agente

Use primeiro uma RB que já tenha internet.

1. gerar `Somente agente`
2. colar no Terminal
3. confirmar:
   - `openwifi-router.token`
   - `openwifi-agent.txt`
   - `/system script print where name="openwifi-cloud-poll"`
   - `/system scheduler print where name="openwifi-cloud-poll"`
4. painel deve exibir:
   - modelo
   - RouterOS
   - identity
   - IP público
   - ONLINE

## D. Token de uso único

Depois de uma adoção bem-sucedida:

1. cole novamente o mesmo bootstrap
2. `/api/router/enroll` deve negar
3. a RB já adotada deve continuar usando sua credencial individual normalmente

## E. Instalação completa em RB de teste

Faça backup/export antes.

1. ether1 ligada à internet
2. gerar:
   - modo completo
   - ether1
   - ether2-ether5
   - 10.77.0.0/24
   - 10.77.0.1
   - pool padrão
3. colar script
4. verificar:
   - bridgeLocal
   - LAN ports
   - interface-list LAN
   - 10.77.0.1/24
   - openwifi-pool
   - openwifi-dhcp
   - OpenWiFi NAT
   - openwifi-profile
   - openwifi-hotspot
   - Walled Garden
   - login.html
   - agent
   - scheduler
5. conectar celular
6. captive portal deve abrir

## F. Integração HotSpot existente

1. informar o nome correto do HotSpot existente
2. gerar modo `Integrar HotSpot existente`
3. confirmar que bridge/DHCP/NAT não foram alterados
4. confirmar Walled Garden/login/agente

## G. Poll e hosts

1. conectar dois aparelhos
2. painel deve atualizar host count
3. `npm run routers:check`
4. confirmar `last_seen_at`

## H. Compra / acesso

Executar novamente os testes da Fase 3B:
- Pix
- 30 segundos
- código
- Party
- velocidade
- encerrar acesso
- cortesia

## I. Desativação segura

1. deixar um aparelho com grant ativo
2. `Desativar integração`
3. aguardar próximo poll
4. confirmar remoção de:
   - `OpenWiFi Cloud` ip-bindings
   - `OpenWiFi Cloud Queue`
   - sessões/cookies correspondentes
5. painel deve mostrar `DESATIVADA`
6. scheduler deve ficar disabled
7. somente depois excluir do painel

## J. RB antiga

Enquanto ainda usa o token global legado:

1. ela deve continuar fazendo poll normalmente
2. não deve precisar ser migrada no mesmo momento do deploy


## K. Hotfix 1.2.1 / RouterOS 7.16.1

1. Deploy da versão `1.2.1-phase4.1`.
2. RB já adotada: não gerar novo enrollment.
3. Rebaixar `/api/router/installer.rsc` usando `openwifi-router.token`.
4. Rodar `/import file-name="openwifi-installer.rsc" verbose=yes dry-run`.
5. Não deve haver `syntax error` nem `expected end of command`.
6. Importar normalmente.
7. Confirmar `openwifi-agent.txt`.
8. Confirmar agente novo e status `installed/complete` no painel.
