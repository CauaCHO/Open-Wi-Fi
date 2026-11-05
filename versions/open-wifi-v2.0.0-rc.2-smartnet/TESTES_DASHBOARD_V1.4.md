# Evidências de validação — Dashboard v1.4

Data: 09/09/2026

## Resultado automatizado

| Verificação | Resultado |
|---|---|
| Sintaxe do Worker (`src/index.js`) | Aprovada |
| JavaScript incorporado no painel | Aprovado |
| JavaScript incorporado no portal | Aprovado |
| IDs duplicados | Nenhum encontrado |
| Referências de interface | 374 conferidas |
| IDs processados | 260 |
| Geração de tipos Cloudflare | Aprovada |
| Compilação Wrangler sem publicar | Aprovada |
| Inicialização local do Worker | Aprovada |
| Rota `/` | HTTP 200 |
| Rota `/health` | HTTP 200, versão 1.4.0-dashboard |
| Rota `/admin` | HTTP 200, HTML completo |
| Rota protegida sem sessão | HTTP 401, conforme esperado |
| Tamanho estimado do Worker | 279,19 KiB |
| Tamanho estimado compactado | 66,89 KiB |
| Auditoria das dependências | 0 vulnerabilidades conhecidas |

Comando principal executado:

```bash
npm run check
```

## O que o teste não altera

- não publica o Worker;
- não aplica migrações no D1;
- não modifica segredos do Cloudflare;
- não cria cobranças reais no Mercado Pago;
- não altera nenhuma MikroTik.

## Testes finais recomendados no ambiente real

Depois de fazer backup e publicar em uma janela de manutenção:

1. entrar no painel com cada perfil de acesso;
2. conferir a visão geral e os alertas com dados reais;
3. buscar e filtrar pagamentos e usuários;
4. criar um Pix de baixo valor e confirmar o webhook;
5. validar a liberação e o encerramento de um acesso;
6. conferir o heartbeat e a contagem de clientes da MikroTik;
7. testar upload e remoção de logo e fundo;
8. confirmar o portal em celular e computador.
