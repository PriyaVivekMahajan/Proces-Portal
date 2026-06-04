# Backup System

Your database (`data/process-dashboard.db`) is backed up automatically. There are **four** layers protecting your data:

| Layer | When it runs | Where it runs |
|---|---|---|
| 1. On server startup | Every time `npm start` boots the app | Inside Node |
| 2. On server shutdown | Ctrl+C / SIGTERM stops the server | Inside Node |
| 3. Daily at 11:00 PM | While the server is running | Inside Node |
| 4. Daily at 11:00 PM | Even if the server is down | Windows Task Scheduler → `backup-now.ps1` |
| 5. Manual button | Click 💾 Backup in the sidebar | Inside Node |

All backups land in `data\backups\` as `process-dashboard-YYYYMMDD-HHMMSS.db`. They use SQLite's atomic online-backup API, so they're consistent even while the app is in use.

---

## One-time setup: register the Windows Task Scheduler job

Open **PowerShell as Administrator** and paste:

```powershell
$Script = "C:\Users\Priyanka Jadhav\Priyanka\process-dashboard-app\backup-now.ps1"

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Script`""

$Trigger = New-ScheduledTaskTrigger -Daily -At 11:00pm

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName "ProcessDashboardBackup" `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Atomic SQLite backup of process-dashboard.db every night at 11 PM."
```

To confirm it registered:
```powershell
Get-ScheduledTask -TaskName "ProcessDashboardBackup"
```

To run it once manually (good smoke test):
```powershell
Start-ScheduledTask -TaskName "ProcessDashboardBackup"
```

Then check `data\backups\backup.log` for the result line.

To remove it:
```powershell
Unregister-ScheduledTask -TaskName "ProcessDashboardBackup" -Confirm:$false
```

---

## Restoring from a backup

1. **Stop the server** (Ctrl+C in the terminal running `npm start`).
2. In `data\`, copy your chosen backup over the live DB:
   ```powershell
   Copy-Item "data\backups\process-dashboard-20260526-230000.db" "data\process-dashboard.db" -Force
   ```
3. Delete the WAL files (otherwise SQLite may stitch in stale uncommitted changes):
   ```powershell
   Remove-Item "data\process-dashboard.db-wal","data\process-dashboard.db-shm" -ErrorAction SilentlyContinue
   ```
4. Restart with `npm start`.

---

## Pruning old backups (manual, optional)

Backups are **never auto-deleted**. To delete backups older than 90 days:
```powershell
Get-ChildItem "data\backups\process-dashboard-*.db" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
  Remove-Item
```

---

## How to confirm backups are happening

- Check `data\backups\` — you should see new `.db` files appearing.
- Check `data\backups\backup.log` — Task Scheduler appends to it on every run.
- In the app, the **Audit Log** records every backup with the reason (`on-startup`, `on-shutdown`, `daily-11pm`, `manual-by-...`).
