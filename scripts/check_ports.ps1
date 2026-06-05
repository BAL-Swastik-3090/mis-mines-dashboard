# ============================================================
#  Mines Dashboard — Port Availability Checker (PowerShell)
#  Usage: .\scripts\check_ports.ps1
#         .\scripts\check_ports.ps1 -Fix
# ============================================================

param(
    [switch]$Fix   # If set, shows commands to free occupied ports
)

# ── Port definitions ─────────────────────────────────────────
$ports = @(
    @{ Port=3333; Service="Frontend";  Desc="Next.js Dashboard UI";    Required=$true  },
    @{ Port=8989; Service="Backend";   Desc="FastAPI REST API";         Required=$true  },
    @{ Port=80;   Service="Nginx";     Desc="Reverse Proxy (Docker)";   Required=$false },
    @{ Port=6379; Service="Redis";     Desc="Cache (Docker internal)";  Required=$false }
)

# ── ANSI color helpers ────────────────────────────────────────
function Write-Green  { param($msg) Write-Host $msg -ForegroundColor Green  }
function Write-Red    { param($msg) Write-Host $msg -ForegroundColor Red    }
function Write-Yellow { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Cyan   { param($msg) Write-Host $msg -ForegroundColor Cyan   }
function Write-Blue   { param($msg) Write-Host $msg -ForegroundColor Blue   }

# ── Check if a TCP port is free ───────────────────────────────
function Test-PortFree {
    param([int]$Port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $result = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $success = $result.AsyncWaitHandle.WaitOne(500, $false)
        if ($success -and $tcp.Connected) {
            $tcp.Close()
            return $false   # port is IN USE
        }
        $tcp.Close()
        return $true        # port is FREE
    } catch {
        return $true        # connection failed → port is FREE
    }
}

# ── Get process holding the port ──────────────────────────────
function Get-ProcessOnPort {
    param([int]$Port)
    try {
        $netstat = netstat -ano | Select-String ":$Port\s" | Select-String "LISTENING"
        if ($netstat) {
            $pid_ = ($netstat -split "\s+")[-1]
            $proc = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
            if ($proc) { return "PID $pid_ ($($proc.ProcessName))" }
            return "PID $pid_"
        }
    } catch {}
    return "unknown process"
}

# ── Banner ────────────────────────────────────────────────────
Write-Host ""
Write-Blue  "──────────────────────────────────────────────────────────"
Write-Blue  "  Kaliapani Mines Dashboard — Port Availability Check"
Write-Blue  "──────────────────────────────────────────────────────────"
Write-Host ""

$allRequiredFree = $true

foreach ($p in $ports) {
    $free    = Test-PortFree -Port $p.Port
    $req     = if ($p.Required) { "[REQUIRED]" } else { "[OPTIONAL]" }
    $reqColor= if ($p.Required) { "White" }     else { "Yellow" }
    $status  = if ($free) { "✅ FREE    " } else { "❌ OCCUPIED" }
    $stColor = if ($free) { "Green" }     else { "Red" }

    Write-Host ("  Port {0,5}  " -f $p.Port) -NoNewline
    Write-Host $status -ForegroundColor $stColor -NoNewline
    Write-Host ("  {0,-11}  {1,-14}  {2}" -f $req, $p.Service, $p.Desc) -ForegroundColor $reqColor

    if (-not $free) {
        $proc = Get-ProcessOnPort -Port $p.Port
        Write-Yellow "             ↳ Occupied by: $proc"

        if ($Fix) {
            Write-Yellow "             To free this port:"
            Write-Yellow "               Find PID : netstat -ano | findstr :$($p.Port)"
            Write-Yellow "               Kill PID : taskkill /PID <PID> /F"
        }

        if ($p.Required) { $allRequiredFree = $false }
    }
}

Write-Host ""

if ($allRequiredFree) {
    Write-Green  "  ✅ All required ports are free. Safe to start!"
    Write-Cyan   "     Frontend → http://localhost:3333"
    Write-Cyan   "     Backend  → http://localhost:8989/api/docs"
} else {
    Write-Red    "  ❌ One or more REQUIRED ports are occupied."
    Write-Yellow "     Free the ports above, then retry."
    if (-not $Fix) {
        Write-Yellow "     Run with -Fix flag to see how:"
        Write-Yellow "     .\scripts\check_ports.ps1 -Fix"
    }
}

Write-Host ""
Write-Blue  "──────────────────────────────────────────────────────────"
Write-Host ""

# Exit with code 1 if any required port is occupied
if (-not $allRequiredFree) { exit 1 }
exit 0
