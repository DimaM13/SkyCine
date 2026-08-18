@echo off
setlocal
cd /d "%~dp0"

cls
echo ===================================================
echo             SkyCine Cinema Server
echo ===================================================
echo.
echo [1/2] Freeing ports 3000 and 5000...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 5000, 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"

echo.
echo [2/2] Starting SkyCine Server and UPnP...
echo.
echo ---------------------------------------------------
echo   Local Browser:      http://localhost:3000
echo   Wi-Fi Devices:      http://192.168.0.100:3000
echo   Public Direct IP:   http://109.104.188.66:3000
echo ---------------------------------------------------
echo.

call npm run dev

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server exited with code %ERRORLEVEL%
)
pause
