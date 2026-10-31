@echo off
chcp 65001 >nul
title Open Wi-Fi v0.9.4 - Validacao
cd /d "%~dp0"

echo ==========================================
echo       OPEN WI-FI - VALIDACAO LOCAL
echo ==========================================
echo.
call npm run check
if errorlevel 1 (
  echo.
  echo [ERRO] A validacao encontrou um problema.
  pause
  exit /b 1
)
echo.
echo [OK] Sintaxe do projeto validada.
echo.
if exist "secrets\firebase-service-account.json" (
  echo [INFO] Testando Firebase Admin...
  call npm run firebase:check
) else (
  echo [AVISO] Service Account nao encontrada; teste Firebase ignorado.
)
echo.
pause
