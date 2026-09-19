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
set NEED_BUILD=0
if not exist "server\dist\index.js" set NEED_BUILD=1
if not exist "client\dist\index.html" set NEED_BUILD=1

REM Rebuild stamp: rebuild when sources are newer than the last build
REM (commit changed after git pull, or uncommitted edits in working tree).
set CUR_COMMIT=
for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set CUR_COMMIT=%%H
set BUILT_COMMIT=
if exist ".build_stamp" set /p BUILT_COMMIT=<".build_stamp"
set DIRTY=
for /f "delims=" %%S in ('git status --porcelain 2^>nul') do set DIRTY=1

if not defined CUR_COMMIT (
  echo Git not available - using dist presence check only.
  goto build_decision
)
if "%CUR_COMMIT%"=="%BUILT_COMMIT%" (
  if not defined DIRTY (
    echo Build stamp OK - dist matches current sources.
    goto build_decision
  )
  echo Uncommitted source changes detected - rebuild needed.
  set NEED_BUILD=1
  goto build_decision
)
echo Sources changed since last build - rebuild needed.
set NEED_BUILD=1

:build_decision
if "%NEED_BUILD%"=="1" goto do_build
echo Build OK (server + client dist up to date).
goto do_start

:do_build
echo (Re)building server + client (takes a while)...
call npm run build:server
if %ERRORLEVEL% NEQ 0 goto build_fail
call npm run build:client
if %ERRORLEVEL% NEQ 0 goto build_fail
if defined CUR_COMMIT (
  >".build_stamp" echo %CUR_COMMIT%
)
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
