@echo off
setlocal
cd /d "%~dp0"

cls
echo ===================================================
echo         SkyCine Cinema Server - PROD MODE
echo     (production build, no Vite dev server)
echo ===================================================
echo.
echo [1/3] Freeing ports 3000 and 5000...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 5000, 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo [2/3] Checking production build...
if not exist "server\dist\index.js" goto do_build
if not exist "client\dist\index.html" goto do_build
echo Build OK (server + client dist present).
goto do_start

:do_build
echo Build missing or incomplete - building server + client (one-time, takes a while)...
call npm run build:server
if %ERRORLEVEL% NEQ 0 goto build_fail
call npm run build:client
if %ERRORLEVEL% NEQ 0 goto build_fail
goto do_start

:build_fail
echo.
echo BUILD FAILED with code %ERRORLEVEL%
pause
exit /b %ERRORLEVEL%

:do_start
echo.
echo [3/3] Starting SkyCine PROD Server (all-in-one on port 5000)...
echo.
echo ---------------------------------------------------
echo   Local Browser:      http://localhost:5000
echo   Wi-Fi Devices:      http://192.168.0.100:5000
echo   TV / Remote:        use port 5000 (NOT 3000 in PROD!)
echo   UPnP forwards:      5000 only (see log below)
echo ---------------------------------------------------
echo.

set NODE_ENV=production
call npm start

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server exited with code %ERRORLEVEL%
)
pause
