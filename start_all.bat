@echo off
setlocal enabledelayedexpansion
title TradingView Advanced Terminal (OANDA v20)

echo ====================================================================================
echo   TRADINGVIEW ADVANCED TERMINAL - OANDA v20 ENGINE + REACT 19 FRONTEND
echo ====================================================================================

set "OANDA_ACCOUNT_ID=101-001-40395350-001"
set "OANDA_API_TOKEN=f2be2aaf1443ae8071a5982196c9e217-13d1b5a73efca27fd1c07b068bdd0832"
set "WEBSITE_PORT=9000"
set "PROXY_PORT=9999"

echo [1/2] Terminating any stale processes on ports 9000, 9999...
for %%P in (9000 9999) do (
    for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%%P" ^| findstr "LISTENING"') do (
        taskkill /F /PID %%a >nul 2>&1
    )
)

echo [2/2] Starting Node.js OANDA Engine & CDN Proxy Server on ports 9000 and 9999...
start /b "" node "%~dp0frontend_server.js"

echo.
echo ====================================================================================
echo   SYSTEM IS ONLINE AND RUNNING!
echo ====================================================================================
echo   [1] Trading Terminal UI:  http://127.0.0.1:9000
echo   [2] Node.js Proxy & API:  http://127.0.0.1:9999
echo   [3] Time Sync (<1ms):     http://127.0.0.1:9000/time
echo ====================================================================================
echo.
pause
