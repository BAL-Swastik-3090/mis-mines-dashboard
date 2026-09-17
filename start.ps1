# ============================================================
#  Mines Dashboard — Windows Startup Script (PowerShell)
#  Checks ports, then starts frontend + backend natively
#  Usage: .\start.ps1
#         .\start.ps1 -Docker      (run via Docker Compose)
#         .\start.ps1 -CheckOnly   (only check ports, don't start)
# ============================================================

param(
    [switch]$Docker,
    [switch]$CheckOnly
)

$FRONTEND_PORT = 3333
$BACKEND_PORT  = 8989

function Write-Banner {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Blue
    Write-Host "  Kaliapani Mines Dashboard — Startup" -ForegroundColor Blue
    Write-Host "  Balasore Alloys Limited · BAL-1100" -ForegroundColor Blue
    Write-Host "============================================================" -ForegroundColor Blue
    Write-Host ""
}

Write-Banner

# ── Step 1: Port Check ────────────────────────────────────────
Write-Host "[ STEP 1 ]  Checking port availability..." -ForegroundColor Cyan
Write-Host ""

& powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\scripts\check_ports.ps1"
$portCheckExitCode = $LASTEXITCODE

if ($portCheckExitCode -ne 0) {
    Write-Host ""
    Write-Host "  ⛔ Startup aborted — free the occupied ports first." -ForegroundColor Red
    Write-Host "     Run: .\scripts\check_ports.ps1 -Fix" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# ── Step 1b: the MineHub tunnel ───────────────────────────────
# MineHub's data lives on the corporate PostgreSQL box. From the office LAN the
# backend reaches it directly; over the VPN the server sees a different address
# and pg_hba refuses it unencrypted, while the server does not serve TLS. An SSH
# tunnel sidesteps both: the connection arrives as 127.0.0.1, which is trusted.
# Without it every MineHub screen answers 503 while the rest of the dashboard,
# which reads MySQL, carries on — a confusing half-failure worth naming up front.
$pgPort = (Select-String -Path "$PSScriptRoot\.env" -Pattern '^PG_PORT=(\d+)' -EA 0).Matches.Groups[1].Value
$pgHost = (Select-String -Path "$PSScriptRoot\.env" -Pattern '^PG_HOST=(.+)' -EA 0).Matches.Groups[1].Value
if ($pgHost -match 'localhost|127\.0\.0\.1') {
    $tunnel = Get-NetTCPConnection -LocalPort $pgPort -State Listen -EA SilentlyContinue
    if ($tunnel) {
        Write-Host "  ✅ MineHub tunnel is up on port $pgPort" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Nothing is listening on port $pgPort — MineHub screens will show a database error." -ForegroundColor Yellow
        Write-Host "     Open the tunnel in its own window, then start again:" -ForegroundColor Yellow
        Write-Host "     ssh -L ${pgPort}:127.0.0.1:5432 USER@POSTGRES-HOST" -ForegroundColor Yellow
    }
    Write-Host ""
}

if ($CheckOnly) {
    Write-Host "  ℹ️  CheckOnly mode — not starting services." -ForegroundColor Yellow
    exit 0
}

# ── Step 2: Start services ────────────────────────────────────
Write-Host "[ STEP 2 ]  Starting services..." -ForegroundColor Cyan
Write-Host ""

if ($Docker) {
    # ── Docker mode ──────────────────────────────────────────
    Write-Host "  🐳 Starting via Docker Compose..." -ForegroundColor Cyan
    docker compose up --build -d
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ❌ Docker Compose failed to start." -ForegroundColor Red
        exit 1
    }
    Write-Host ""
    Write-Host "  ✅ All containers started!" -ForegroundColor Green
    Write-Host "     Dashboard  → http://localhost" -ForegroundColor Cyan
    Write-Host "     API Docs   → http://localhost/api/docs" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  View logs: docker compose logs -f" -ForegroundColor Yellow
} else {
    # ── Native dev mode ──────────────────────────────────────
    Write-Host "  🚀 Starting Backend  (FastAPI · port $BACKEND_PORT)..." -ForegroundColor Green
    $backend = Start-Process -FilePath "powershell" `
        -ArgumentList "-NoExit", "-Command", `
            "cd '$PSScriptRoot\backend'; uvicorn app.main:app --reload --port $BACKEND_PORT" `
        -PassThru -WindowStyle Normal

    Start-Sleep -Seconds 3

    Write-Host "  🚀 Starting Frontend (Next.js · port $FRONTEND_PORT)..." -ForegroundColor Green
    $frontend = Start-Process -FilePath "powershell" `
        -ArgumentList "-NoExit", "-Command", `
            "cd '$PSScriptRoot\frontend'; npm run dev" `
        -PassThru -WindowStyle Normal

    Write-Host ""
    Write-Host "  ✅ Services started in separate windows!" -ForegroundColor Green
    Write-Host "     Frontend  → http://localhost:$FRONTEND_PORT" -ForegroundColor Cyan
    Write-Host "     Backend   → http://localhost:$BACKEND_PORT" -ForegroundColor Cyan
    Write-Host "     API Docs  → http://localhost:$BACKEND_PORT/api/docs" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Close the terminal windows to stop the services." -ForegroundColor Yellow
}

Write-Host ""
