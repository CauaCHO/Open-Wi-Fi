# Open Wi-Fi v1.6.1 — relatório curto

## Preservado

Worker, D1, R2, Mercado Pago, MikroTik, portal cativo, autenticação, recursos da v1.6.0 e histórico de migrations. Nenhum fluxo físico da RB foi alterado.

## Alterado

- O painel permite cancelar códigos disponíveis ou usados. O servidor valida o papel de operador, limita a operação ao estabelecimento configurado, marca o código como `cancelled`, revoga apenas o acesso daquele código e registra auditoria. Códigos cancelados não podem ser resgatados novamente. Para testar outro celular, gere outro código.
- O portal aceita navegadores cativos que bloqueiam `localStorage`. O servidor atribui o identificador do dispositivo quando necessário. Há limite de 15 segundos na preparação, opção de tentar novamente e mensagem específica quando a MikroTik ainda não enviou o aparelho.
- O resgate de código só cria a concessão se o código ainda estiver elegível após a atualização, evitando concessão durante cancelamento concorrente.

## Validado

- Sintaxe do Worker e dos scripts HTML; contrato local de autorização e cancelamento (75 verificações); interface (323 IDs, 4 scripts, 502 referências, 120 botões); portal com armazenamento bloqueado; migrations existentes em SQLite; compilação Wrangler `--dry-run`.
- Publicado no Worker `openwifi-api` em 2026-10-30 UTC. O `/health` público respondeu com `1.6.1-code-cancel-portal`; os 20 vínculos do Worker, incluindo D1, R2 e segredos, permaneceram presentes. A consulta pública da área de códigos continuou exigindo autenticação e o portal carregou com a nova mensagem de orientação.
- Nenhuma migration nova. O npm do ambiente de validação falhou com `Exit handler never called`; a compilação usou as dependências já instaladas na cópia v1.6.0.

## Pendente

- Testar o cancelamento com um código real e observar a remoção do acesso na RB.
- Instalar o agente da CHO-Gateway. Ela está cadastrada como `enrolled`, sem heartbeat recente. O usuário confirmou que não há script nem agendador `openwifi-cloud-poll` na RB; os aparelhos vistos pelo servidor vinham da integração antiga. Como há um HotSpot `hotspot-cho` existente, o próximo script deve usar **Somente agente**.
- A ferramenta de migrations local usa esquema inicial inferido porque os arquivos originais 0001–0002 não estão no pacote.
