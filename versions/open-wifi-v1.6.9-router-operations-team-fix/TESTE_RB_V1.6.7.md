# Teste da v1.6.7 em uma RB de teste

1. Guarde um backup/export da RB e confirme RouterOS 7.16.1 ou outra versão 7 compatível antes de começar.
2. No modo **HotSpot existente**, informe exatamente o nome do HotSpot que aparece na RB. Gere um script novo, execute uma vez e confirme que a RB fica ONLINE e que o acesso de teste funciona.
3. No modo **Somente agente**, informe também o nome do HotSpot existente. Esse modo deve instalar apenas agente e scheduler; não deve alterar portal, bridge, DHCP ou NAT.
4. No modo **Instalação completa**, use uma RB limpa, com WAN e LAN distintas. O painel deve rejeitar WAN repetida na LAN e rede, gateway ou pool incompatíveis antes de gerar o script.
5. Após cada instalação, confira no painel o último contato e a etapa de instalação. Em caso de falha, anote apenas o nome da etapa e as linhas recentes do log OpenWiFi, sem copiar token ou arquivo de credencial.
6. Reinicie a RB de teste e confirme que ela volta a ficar ONLINE; em equipamentos com pasta `flash`, a credencial deve estar em `flash/openwifi-router.token`.

Este roteiro valida o comportamento físico que os testes locais não conseguem reproduzir.
