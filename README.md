# Open Wi-Fi

Plataforma de gestão de hotspots com Cloudflare Workers, D1, R2, MikroTik RouterOS e Mercado Pago PIX.

## Arquivo de versões

Este repositório guarda as 40 versões do projeto, incluindo a v1.6.9 preparada em 31/10/2026:

- [`versions/`](versions/) contém cada pacote descompactado, em uma pasta com o nome do ZIP original.
- [`archives/`](archives/) contém os ZIPs originais e um [arquivo de hashes SHA-256](archives/SHA256SUMS.txt) para conferência.
- [`docs/`](docs/) contém as propostas e documentos da pasta principal do projeto.

A versão mais recente neste arquivo é a [v1.6.9](versions/open-wifi-v1.6.9-router-operations-team-fix/). As pastas de versões anteriores são registros históricos e podem exigir configuração ou migrações diferentes para execução. A v1.6.8 está publicada; a v1.6.9 foi validada localmente e ainda requer aplicação da migração `0014` e publicação do Worker.

Credenciais locais, arquivos `.env` reais e contas de serviço não fazem parte deste repositório. Configure segredos pelo ambiente de implantação; os arquivos `.env.example` nos pacotes servem apenas de modelo.
