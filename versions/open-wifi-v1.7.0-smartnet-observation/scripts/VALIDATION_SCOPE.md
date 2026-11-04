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

`validate-contracts.mjs` importa o Worker real e executa 94 verificações locais de contrato. Confere autenticação administrativa, cookies inválidos/expirados, restrições de viewer/operator, atualização de papel a partir de uma resposta D1 controlada, conta desativada e proteção da conta principal. Também verifica dois contextos de estabelecimento, consultas de plataforma escopadas, heartbeat de roteadores, nome do HotSpot no agente gerado, passos de recuperação no instalador, rejeição de configurações de rede inválidas e as páginas `/admin`, `/portal` e `/group`.

Os cookies são assinados apenas com uma chave local de teste. O teste adapta `crypto.subtle.timingSafeEqual`, extensão disponível no Cloudflare, para a implementação nativa do Node. As respostas D1 são stubs limitados: não validam consultas reais nem a integridade de um banco implantado. Requisições de rede causam falha imediata no teste.

## Migrações

`validate-migrations.py` executa as doze migrações históricas (`0001` a `0012`) em SQLite na memória. As migrações `0001` e `0002` foram recuperadas do pacote original v1.0 da pasta local `Versões`.

O teste confere execução do SQL a partir de uma base vazia, dados iniciais, integridade, chaves estrangeiras, unicidade de tentativa ativa por dispositivo e restrições de token/modo dos roteadores. Ele não comprova a implantação em D1 remoto nem compatibilidade com dados já existentes em produção. O pacote não inclui alteração de esquema para esta revisão.

## Limites

- Os testes de sintaxe/contrato não substituem navegação visual e testes de interação no navegador.
- Pagamentos reais, webhooks, R2, instalação/provisionamento em RouterOS, filas e acesso à internet exigem seus ambientes próprios.
- O resultado do validador estático de interface descreve IDs, scripts e referências; não é uma certificação completa de acessibilidade.
- As migrações iniciais agora estão incluídas, mas a instalação limpa do aplicativo completo ainda precisa de validação em um D1 de teste.
