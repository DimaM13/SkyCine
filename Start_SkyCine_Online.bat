@echo off
setlocal
cd /d "%~dp0"

cls
echo ===================================================
echo             SkyCine Online Server
echo ===================================================
echo.
echo [1/2] Freeing ports 3000 and 5000...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 5000, 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo [2/2] Starting SkyCine Server and Cloudflare Tunnel...
echo.

call npm run dev:online

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server exited with code %ERRORLEVEL%
)
pause
