# Open Wi-Fi v1.6.4 — correção da instalação e persistência da RB

## Preservado

- Worker, D1, R2, Mercado Pago, autenticação, captive portal, painel e integração MikroTik.
- As 20 bindings de produção foram preservadas na publicação da v1.6.4.
- Não há migration nova nem alteração de esquema.

## Corrigido

- O instalador cria `openwifi-cloud-poll` diretamente do arquivo baixado, sem intermediá-lo numa variável. O mesmo comando funcionou na hEX RouterOS 7.16.1 durante o reparo manual.
- Novas adoções gravam `openwifi-router.token` em `flash/` quando a pasta existe. Agente e instalador procuram primeiro em `flash/` e aceitam o caminho antigo durante a transição.
- O guia de recuperação e o agente avulso foram alinhados ao caminho persistente.

## Validação

- Sintaxe do Worker: `node --check src/index.js`.
- 76 verificações locais de contratos do Worker.
- Painel: 323 IDs, 4 scripts, 502 referências e 120 botões conferidos.
- Portal captive: acesso aos planos com armazenamento do navegador bloqueado.
- 10 migrations de atualização executadas em base SQLite de teste inferida. Os schemas originais 0001–0002 não estão no pacote, portanto instalação de D1 do zero não foi validada.
- Empacotamento Wrangler `deploy --dry-run`: concluiu, com aviso de permissão apenas para gravar o log local.
- Publicação confirmada em `/health`: `1.6.4-router-persistence`, Mercado Pago e segredo do webhook configurados. As 20 bindings foram conferidas após a publicação.
- Na RB real: bridge, pool, DHCP, HotSpot e portal em `flash/hotspot` presentes; agente criado e executado; scheduler de 10 segundos criado; contatos contínuos observados no D1. A credencial foi copiada para `flash/` sem exibir seu conteúdo. O agente v1.6.4 foi baixado, executado e selecionado no scheduler como `openwifi-cloud-poll-next`; o script anterior ficou como reserva. Contatos continuaram após a troca.

## Pendente

- Confirmar persistência após um reinício controlado da RB. O reinício não foi feito durante esta intervenção.
- Repetir uma instalação completa em outra RB limpa para confirmar o gerador corrigido de ponta a ponta. A causa exata do erro original no RouterOS não foi registrada; a correção reproduz a operação que funcionou manualmente.
