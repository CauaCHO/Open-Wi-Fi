# Open Wi-Fi v1.6.0 — relatório de revisão

## Preservado

- Worker e APIs de pagamento, acesso, provisionamento, administração e diagnóstico.
- Integrações D1, R2, Mercado Pago e MikroTik; autenticação e papéis administrativos.
- Fluxos de dispositivo, planos, Pix, códigos e acesso temporário do captive portal.
- Escopo do estabelecimento configurado no servidor. A seleção de outros locais não foi simulada no frontend.
- Nenhuma migration ou mudança na configuração da RB foi adicionada.

## Alterado

- `/` agora tem site institucional responsivo com metadados SEO/Open Graph, funcionamento, recursos e FAQ. O mock do painel está identificado como ilustrativo. A copy é proposta para revisão.
- Portal com paleta Dark Tech, layout mobile-first, rótulos de campos, foco visível, estados de pagamento e recuperação de erro.
- Aprovação do Pix e permissão de acesso ativa são apresentadas separadamente. A tela não afirma que a internet funciona só porque o pagamento foi aprovado.
- Editor com prévia em smartphone, indicação de textos não salvos, planos ativos obtidos da API e botão para localizar a prévia em telas pequenas.
- Receita bruta do mês baseada em pagamentos aprovados desde o início do mês em São Paulo. O valor vem de D1 e não representa líquido, estornos ou repasses.

## Testado

- `npm run check`: sintaxe do Worker, 323 IDs das três páginas, quatro scripts embutidos, 502 referências, 119 botões, 73 verificações de contratos locais e dry-run do Wrangler passaram. O Wrangler mostrou falha de permissão ao gravar seu log fora da pasta do projeto, mas concluiu o dry-run com código zero.
- `npm run validate:migrations`: dez migrations de upgrade passaram em SQLite mínimo inferido. Os arquivos originais 0001 e 0002 não constam deste pacote; instalação D1 do zero não foi validada.
- O navegador automatizado deste ambiente não abriu. Testes visuais e interativos nas larguras pedidas permanecem pendentes.
- Não houve teste real de Pix, webhook, R2, RB física, liberação ou publicação da v1.6.0.

## Ainda pendente do prompt mestre

- Multiestabelecimento com isolamento e autorização completos no backend, comparativo entre locais e painel separado por estabelecimento.
- Contagem confiável de usuários conectados em tempo real. Acesso ativo registrado não equivale a usuário conectado à RB.
- Gráficos adicionais por período e estabelecimento, com consultas e filtros seguros baseados em dados reais.
- Campos e persistência de cor principal, Instagram, banner promocional, descrição/destaque de plano e associação de planos a hotspots. O editor atual usa somente campos existentes no backend.
- Contato comercial real para a landing. Não foi inventado número de WhatsApp ou formulário de leads.
- Revisão visual completa em navegador, teste em captive browser e RB limpa.

## Próxima sequência

Revisar copy e interface em navegador real; definir isolamento multiestabelecimento no backend; evoluir schema e APIs para personalização e métricas restantes; validar Pix e provisionamento antes de publicar.
