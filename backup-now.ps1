# ============================================================
# Standalone backup script for Windows Task Scheduler.
# Runs an atomic SQLite backup of data/process-dashboard.db
# into data/backups/, even if the Node server is stopped.
# ============================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

$logDir = Join-Path $ScriptDir "data\backups"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir "backup.log"

function Log($msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Host $line
}

try {
    Log "starting backup (Task Scheduler)"
    & node "$ScriptDir\backup-cli.js"
    if ($LASTEXITCODE -ne 0) {
        Log "FAILED with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
    Log "OK"
    exit 0
} catch {
    Log ("EXCEPTION: " + $_.Exception.Message)
    exit 1
}
