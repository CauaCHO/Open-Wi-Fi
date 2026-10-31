@echo off
chcp 65001 >nul
title Open Wi-Fi v0.9.2 - Publicar Firebase
cd /d "%~dp0"

echo ==========================================
echo     OPEN WI-FI - PUBLICAR FIREBASE
echo ==========================================
echo.

if not exist "package.json" (
  echo [ERRO] package.json nao encontrado nesta pasta.
  pause
  exit /b 1
)

if not exist "newlogo.png" (
  echo [AVISO] newlogo.png nao esta na raiz do projeto.
  echo O painel pode continuar usando a ultima logo copiada.
  echo.
)

echo [INFO] Publicando Hosting do painel remoto...
call npm run firebase:deploy
if errorlevel 1 (
  echo.
  echo [ERRO] O deploy falhou.
  echo Se for a primeira vez, execute: npm run firebase:login
  pause
  exit /b 1
)

echo.
echo [OK] Painel Firebase publicado.
echo https://open-wi-fi-ofc.web.app
pause
