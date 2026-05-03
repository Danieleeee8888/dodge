@echo off
setlocal
cd /d "%~dp0"
set PORT=8765
REM Larghezza x altezza finestra ~telefono (modifica qui se vuoi altro device)
set PHONE_W=390
set PHONE_H=844

echo.
echo  DODGE — server locale  http://127.0.0.1:%PORT%/
echo  Si apre Chrome/Edge in finestra ~%PHONE_W%x%PHONE_H% px (modalita app).
echo  Ctrl+C per chiudere il server.
echo.

REM Apre il browser dopo 1s con misure tipo smartphone (Chrome o Edge)
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-phone-preview.ps1" -Port %PORT% -Width %PHONE_W% -Height %PHONE_H%

python -m http.server %PORT% 2>nul
if %ERRORLEVEL% equ 0 goto :eof

py -m http.server %PORT% 2>nul
if %ERRORLEVEL% equ 0 goto :eof

echo.
echo  Nessun Python trovato nel PATH.
echo  Installa Python da https://www.python.org/ oppure, se hai Node.js:
echo    npx --yes serve . -l %PORT%
echo.
pause
