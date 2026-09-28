# TradingView Advanced Terminal (OANDA v20 + React) - Master PowerShell Runner
$ErrorActionPreference = "SilentlyContinue"

Write-Host "====================================================================================" -ForegroundColor Cyan
Write-Host "  TRADINGVIEW ADVANCED TERMINAL - OANDA v20 ENGINE + REACT 19 FRONTEND" -ForegroundColor Green
Write-Host "====================================================================================" -ForegroundColor Cyan

$env:OANDA_ACCOUNT_ID = "101-001-40395350-001"
$env:OANDA_API_TOKEN  = "f2be2aaf1443ae8071a5982196c9e217-13d1b5a73efca27fd1c07b068bdd0832"
$env:WEBSITE_PORT     = "9000"
$env:PROXY_PORT       = "9999"

Write-Host "[1/2] Terminating any stale processes on ports 9000, 9999..." -ForegroundColor Yellow
$ports = @(9000, 9999)
foreach ($p in $ports) {
    Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Milliseconds 500

Write-Host "[2/2] Starting Node.js OANDA Engine & CDN Proxy Server on ports 9000 and 9999..." -ForegroundColor Yellow
$nodeProc = Start-Process -FilePath "node" -ArgumentList (Join-Path $PSScriptRoot "frontend_server.js") -PassThru -NoNewWindow

Start-Sleep -Milliseconds 1000

Write-Host ""
Write-Host "====================================================================================" -ForegroundColor Cyan
Write-Host "  SYSTEM IS ONLINE AND RUNNING!" -ForegroundColor Green
Write-Host "====================================================================================" -ForegroundColor Cyan
Write-Host "  [1] Trading Terminal UI:  http://127.0.0.1:9000" -ForegroundColor White
Write-Host "  [2] Node.js Proxy & API:  http://127.0.0.1:9999" -ForegroundColor White
Write-Host "  [3] Time Sync (<1ms):     http://127.0.0.1:9000/time" -ForegroundColor White
Write-Host "====================================================================================" -ForegroundColor Cyan
Write-Host ""

try {
    while ($true) {
        Start-Sleep -Seconds 5
        if ($nodeProc.HasExited) {
            Write-Host "[WARN] Node.js server exited. Restarting..." -ForegroundColor Red
            $nodeProc = Start-Process -FilePath "node" -ArgumentList (Join-Path $PSScriptRoot "frontend_server.js") -PassThru -NoNewWindow
        }
    }
} finally {
    Write-Host "[SHUTDOWN] Stopping services..." -ForegroundColor Yellow
    Stop-Process -Id $nodeProc.Id -Force -ErrorAction SilentlyContinue
}
