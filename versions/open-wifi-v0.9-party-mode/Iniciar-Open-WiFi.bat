@echo off
chcp 65001 >nul
title Open Wi-Fi v0.9

cd /d "%~dp0"

echo ==========================================
echo          OPEN WI-FI - INICIANDO
echo ==========================================
echo.

if not exist "package.json" (
    echo [ERRO] package.json nao encontrado.
    echo Coloque este arquivo .bat na pasta raiz do projeto Open Wi-Fi.
    echo.
    pause
    exit /b 1
)

if not exist ".env" (
    echo [ERRO] Arquivo .env nao encontrado.
    echo Configure o .env antes de iniciar o projeto.
    echo.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Node.js nao foi encontrado no computador.
    echo Instale o Node.js e tente novamente.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERRO] npm nao foi encontrado no computador.
    echo Reinstale o Node.js com o npm habilitado.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Dependencias ainda nao instaladas.
    echo [INFO] Executando npm install...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha ao instalar as dependencias.
        pause
        exit /b 1
    )
    echo.
)

echo [OK] Projeto encontrado.
echo [INFO] Iniciando o servidor Open Wi-Fi...
echo [INFO] O painel local sera aberto automaticamente.
echo.
echo Para encerrar o servidor, pressione CTRL+C nesta janela.
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:8080/admin"

call npm start

echo.
echo ==========================================
echo        OPEN WI-FI FOI ENCERRADO
echo ==========================================
pause
