@echo off
REM GastroBar Print: deja este programa abierto en el PC de las impresoras.
REM Para que arranque con Windows: Win+R, escribe shell:startup y copia ahi un acceso directo a este archivo.
cd /d "%~dp0"
title GastroBar Print
:loop
node gastrobar-print.mjs
echo.
echo GastroBar Print se detuvo. Reintentando en 15 segundos...
timeout /t 15 >nul
goto loop
