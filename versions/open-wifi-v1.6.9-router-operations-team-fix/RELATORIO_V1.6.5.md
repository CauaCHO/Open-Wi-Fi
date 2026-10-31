# Open Wi-Fi v1.6.5 — cadastros de MikroTik desativados

## Problema

O painel deixava cadastros em `DESATIVANDO` para sempre quando a RB não voltava a se conectar para confirmar a limpeza. A API bloqueava a exclusão de qualquer cadastro que tivesse um contato anterior, mesmo quando o agente nunca foi instalado ou a RB já havia sido substituída por uma nova integração no mesmo equipamento.

## Correção

- Após o prazo de contato configurado, um cadastro sem confirmação aparece como `DESATIVADA`, com a situação da limpeza local explícita.
- O servidor permite excluir um cadastro desativado quando a RB confirmou a limpeza, nunca enviou contato, nunca instalou o agente, ou foi substituída por uma integração ativa na mesma RB. A substituição exige o mesmo número de série e contato recente do novo cadastro.
- Uma RB que ainda pode ter configuração local ativa continua bloqueada para exclusão até confirmar a limpeza ou ser substituída. A desativação mantém o token do cadastro para que, se a RB voltar, receba a ordem de limpeza.
- Nenhuma configuração física da RB é alterada por esta versão. Não há migration nova.

## Validação

- `node --check src/index.js`.
- 80 verificações locais de contratos, incluindo exclusão permitida e bloqueada.
- Validação do painel e portal captive concluída.
- Empacotamento com `wrangler deploy --dry-run` concluído. O Wrangler mostrou apenas um aviso de permissão ao gravar seu log local.

## Cadastros de produção

- `RB-ZTE-E2320`: RouterOS 6, sem instalação concluída; o último contato coincide com a adoção.
- `Nova MikroTik`: cadastro antigo da mesma RB física que agora consta online como `MicroTik Again`.
- A remoção dos dois cadastros antigos foi autorizada pelo usuário e concluída. As duas inscrições vinculadas também foram removidas; os eventos de exclusão foram registrados em `admin_audit`.
- `MicroTik Again` permaneceu como único roteador cadastrado, habilitado e com contato recente.
- O `/health` público confirmou `1.6.5-router-retirement`, Mercado Pago e segredo do webhook configurados. As 20 bindings do Worker foram preservadas.
