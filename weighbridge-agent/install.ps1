# MineHub Weighbridge Agent - install on a weighbridge PC
#
#   Run from an elevated PowerShell, in the folder holding
#   MineHubWeighbridge.exe:
#
#       .\install.ps1 -Token "<token from the portal>" -Bridge WB3
#
# WHAT IT DOES
#   Copies the agent to C:\Program Files\MineHub\Weighbridge, writes the
#   settings file, locks that file down so the weighbridge operator cannot
#   read the token or point the agent somewhere else, and registers a Windows
#   service so it starts with the machine and survives a logout.
#
# WHY A SCHEDULED TASK AND NOT A SERVICE OR A SHORTCUT
#   A desktop shortcut runs as whoever is logged in, dies when they log out,
#   and can be closed from the taskbar. A weighbridge that stops recording
#   because somebody logged off is worse than one that never recorded, because
#   nobody notices until the figures are needed.
#
#   A Windows service would be the textbook answer and this is not a service
#   binary: a service must talk to the Service Control Manager and report that
#   it has started, which a plain console program does not do. Registering it
#   as one produced exactly what that mistake always produces — "cannot be
#   started", with no further explanation.
#
#   A scheduled task set to run at system startup, as SYSTEM, whether or not
#   anyone is logged on, gives the same three things a service would: it starts
#   with the machine, runs for every user, and survives a logout. No wrapper,
#   no extra software.
#
# WHAT IT DOES NOT DO
#   It does not touch C:\WB3\wbdata.txt, the digitizer, or SAP. The agent
#   reads; it never writes to the indicator or its file.
#
# WHY -Source DEFAULTS TO file AND NOT serial
#   On this site the digitizer is WeighStar (D:\WeighStar\WB_D.exe). It holds
#   COM1 and writes C:\WB3\wbdata.txt, which is what SAP GUI reads. A serial
#   port on Windows admits one process: if this agent took COM1, WeighStar
#   could not open it, the file would stop updating and SAP would stop getting
#   weights. Reading the file costs a little directness and keeps the existing
#   weighbridge working, which matters more.
#
#   Pass -Source serial only where nothing else owns the port.
#
# WHY -Server IS A DOMAIN AND NOT AN IP
#   The backend listens on 127.0.0.1:8006 on the application server and is only
#   reachable through the host nginx, which serves mines.balasorealloys.in and
#   routes /api/ to it. An IP and port would not answer even from inside the
#   network. The domain also keeps the server's address out of this repository,
#   which is where DEPLOY.md says it belongs.

param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$Bridge  = "WB3",
    [string]$Server  = "https://mines.balasorealloys.in",
    [string]$Source  = "file",
    [string]$Port    = "COM1",
    [int]   $Baud    = 9600,
    [string]$Path    = "C:\WB3\wbdata.txt",
    [string]$Parser  = "auto",
    [switch]$NoService
)

$ErrorActionPreference = "Stop"

# A value quoted by whatever shell invoked this arrives with the quotes still
# attached. Strip them here rather than write them into the settings file.
function Unquote([string]$v) {
    if ($v -and $v.Length -gt 1 -and $v[0] -eq $v[-1] -and ($v[0] -eq "'" -or $v[0] -eq '"')) {
        return $v.Substring(1, $v.Length - 2)
    }
    return $v
}
$Token  = Unquote $Token
$Server = Unquote $Server
$Bridge = Unquote $Bridge
$Path   = Unquote $Path
$Parser = Unquote $Parser
$Source = Unquote $Source
$Port   = Unquote $Port
$Target  = "C:\Program Files\MineHub\Weighbridge"
$Exe     = Join-Path $Target "MineHubWeighbridge.exe"
$Ini     = Join-Path $Target "wbagent.ini"
$Service = "MineHubWeighbridge"

function Say($m) { Write-Host "  $m" }

# --- must be elevated -------------------------------------------------------
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Run this from an elevated PowerShell (Run as administrator)."
}

Write-Host "`nMineHub Weighbridge Agent - install`n"

# --- the binary -------------------------------------------------------------
$src = Join-Path $PSScriptRoot "MineHubWeighbridge.exe"
if (-not (Test-Path $src)) { Write-Error "MineHubWeighbridge.exe is not beside this script." }

if (Get-Service -Name $Service -ErrorAction SilentlyContinue) {
    Say "stopping the running service"
    Stop-Service $Service -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item $src $Exe -Force
Say "installed to $Target"

# --- the settings -----------------------------------------------------------
@"
; MineHub Weighbridge Agent - written by install.ps1 on $(Get-Date -Format 'dd-MM-yyyy HH:mm')
;
; The token identifies this machine to the server. Treat it like a password.
; Run  MineHubWeighbridge.exe --probe  to find the port and baud rate.

[agent]
server  = $Server
token   = $Token
bridge  = $Bridge
source  = $Source
port    = $Port
baud    = $Baud
path    = $Path
parser  = $Parser
poll_ms = 400

[stability]
samples      = 5
tolerance_kg = 20
"@ | ForEach-Object { [IO.File]::WriteAllText($Ini, $_, (New-Object Text.UTF8Encoding $false)) }
# UTF8Encoding($false) - no byte-order mark. Set-Content -Encoding UTF8 writes
# one in Windows PowerShell 5.1, and configparser rejects the whole file.
Say "settings written"

# --- lock the settings down -------------------------------------------------
# The token is in here. An operator who can read it can post readings from
# anywhere; one who can edit this file can point the agent at a file they
# control. Neither is a thing a weighbridge operator needs to be able to do.
$acl = Get-Acl $Ini
$acl.SetAccessRuleProtection($true, $false)       # stop inheriting
$acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
foreach ($who in @("SYSTEM", "Administrators")) {
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
        $who, "FullControl", "Allow")))
}
Set-Acl -Path $Ini -AclObject $acl
Say "settings readable only by SYSTEM and Administrators"

# --- start it with the machine ------------------------------------------------
if ($NoService) {
    Say "autostart not configured (-NoService). Run the exe by hand to test."
} else {
    # Anything left from an earlier attempt, including the service that could
    # never have started.
    if (Get-Service -Name $Service -ErrorAction SilentlyContinue) {
        Stop-Service $Service -Force -ErrorAction SilentlyContinue
        sc.exe delete $Service | Out-Null
        Say "removed the old service registration"
    }
    Unregister-ScheduledTask -TaskName $Service -Confirm:$false -ErrorAction SilentlyContinue
    Get-Process MineHubWeighbridge -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue

    $action  = New-ScheduledTaskAction -Execute $Exe -Argument "--headless" `
                                       -WorkingDirectory $Target
    $trigger = New-ScheduledTaskTrigger -AtStartup
    # SYSTEM, so it is running before anybody logs in and keeps running after
    # they log out. S4U would tie it to one person's account; this belongs to
    # the machine.
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" `
                                            -LogonType ServiceAccount `
                                            -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet `
                    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                    -StartWhenAvailable -RestartCount 999 `
                    -RestartInterval (New-TimeSpan -Minutes 1) `
                    -ExecutionTimeLimit ([TimeSpan]::Zero) `
                    -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $Service -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings `
        -Description ("Reads the weighbridge weight and sends it to MineHub. " +
                      "Reads only - never writes to the indicator, to " +
                      "C:\WB3\wbdata.txt, or to WeighStar.") | Out-Null

    Start-ScheduledTask -TaskName $Service
    Start-Sleep -Seconds 5
    $t = Get-ScheduledTask -TaskName $Service
    $i = Get-ScheduledTaskInfo -TaskName $Service
    Say "task '$Service' registered - state $($t.State), last result $($i.LastTaskResult)"
    $proc = Get-Process MineHubWeighbridge -ErrorAction SilentlyContinue
    if ($proc) { Say "running as PID $($proc.Id)" }
    else       { Say "WARNING: the task started but no process is running - check the token" }
}

Write-Host "`nNext:`n"
Write-Host "  1. Find the indicator:   `"$Exe`" --probe"
Write-Host "  2. Or check the file:    `"$Exe`" --sniff"
Write-Host "  3. Watch it live in the portal under Weighbridge > Bridges & agents."
Write-Host "`n  If --probe finds a different port or baud rate, edit"
Write-Host "  $Ini and restart the service:"
Write-Host "      Restart-Service $Service`n"
