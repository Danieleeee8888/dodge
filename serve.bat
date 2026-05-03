@echo off
setlocal
cd /d "%~dp0"
set PORT=8765

echo.
echo  DODGE — server locale  http://127.0.0.1:%PORT%/
echo  (stesso comportamento di GitHub Pages; Ctrl+C per chiudere)
echo.

REM Apre il browser dopo un attimo così il server e gia in ascolto
start "" cmd /c "timeout /t 1 /nobreak >nul & start http://127.0.0.1:%PORT%/"

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
