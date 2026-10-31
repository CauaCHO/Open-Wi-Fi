# Escopo dos testes locais

Execute na raiz do pacote:

```text
node --check src/index.js
node scripts/validate-dashboard.mjs
node scripts/validate-contracts.mjs
python scripts/validate-migrations.py
```

Os scripts não acessam o Worker publicado, o Mercado Pago, uma RB ou o D1 remoto.

## Contratos do Worker

`validate-contracts.mjs` importa o Worker real e executa 71 verificações de status HTTP, com assertions adicionais sobre as respostas e consultas. Confere autenticação administrativa, cookies inválidos/expirados, restrições de viewer/operator, atualização de papel a partir de uma resposta D1 controlada, conta desativada e proteção da conta principal. Também verifica dois contextos de estabelecimento, todas as consultas de plataforma escopadas, heartbeat de roteadores e as páginas `/admin`, `/portal` e `/group`: resposta HTTP, cabeçalhos, compilação dos scripts e ausência de valores secretos fornecidos pelo teste.

Os cookies são assinados apenas com uma chave local de teste. O teste adapta `crypto.subtle.timingSafeEqual`, extensão disponível no Cloudflare, para a implementação nativa do Node. As respostas D1 são stubs limitados: não validam consultas reais nem a integridade de um banco implantado. Requisições de rede causam falha imediata no teste.

## Migrações

`validate-migrations.py` executa as dez migrações existentes (`0003` a `0012`) em SQLite na memória. Como o pacote de upgrade não traz `0001`/`0002` nem o schema original, a base do teste é uma fixture **mínima e inferida**, declarada no próprio script. Essa fixture não deve ser usada para criar um banco da aplicação.

O teste confere execução do SQL, integridade, chaves estrangeiras, unicidade de tentativa ativa por dispositivo e restrições de token/modo dos roteadores. Ele não comprova instalação limpa em D1 nem compatibilidade com o schema real de produção. O pacote não inclui migração nova para esta revisão.

## Limites

- Os testes de sintaxe/contrato não substituem navegação visual e testes de interação no navegador.
- Pagamentos reais, webhooks, R2, instalação/provisionamento em RouterOS, filas e acesso à internet exigem seus ambientes próprios.
- O resultado do validador estático de interface descreve IDs, scripts e referências; não é uma certificação completa de acessibilidade.
- A implantação exige o banco base existente. A ausência das primeiras migrações é uma limitação do pacote de upgrade recebido.
