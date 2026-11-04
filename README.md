# Open Wi-Fi

Plataforma de gestão de hotspots com Cloudflare Workers, D1, R2, MikroTik RouterOS e Mercado Pago PIX.

## Arquivo de versões

Este repositório guarda as 41 versões do projeto, incluindo a v1.7.0 SmartNet Observação publicada em 04/11/2026:

- [`versions/`](versions/) contém cada pacote descompactado, em uma pasta com o nome do ZIP original.
- [`archives/`](archives/) contém os ZIPs originais e um [arquivo de hashes SHA-256](archives/SHA256SUMS.txt) para conferência.
- [`docs/`](docs/) contém as propostas e documentos da pasta principal do projeto.

A versão mais recente neste arquivo é a [v1.7.0](versions/open-wifi-v1.7.0-smartnet-observation/). As pastas de versões anteriores são registros históricos e podem exigir configuração ou migrações diferentes para execução. A v1.7.0 está publicada; a migração `0015` foi aplicada no Cloudflare D1. O SmartNet está em modo de observação e a RB atual ainda usa o agente anterior.

Credenciais locais, arquivos `.env` reais e contas de serviço não fazem parte deste repositório. Configure segredos pelo ambiente de implantação; os arquivos `.env.example` nos pacotes servem apenas de modelo.
