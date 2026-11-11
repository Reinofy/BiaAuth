@echo off
chcp 65001 >nul
title BiaAuth - Plataforma de Assinatura Digital
echo =========================================================
echo   Iniciando BiaAuth - Plataforma de Assinatura Digital
echo   Abrindo navegador em http://localhost:3000 ...
echo =========================================================
start http://localhost:3000
node server.js
pause

