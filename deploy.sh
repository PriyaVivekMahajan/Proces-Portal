#!/usr/bin/env bash
# ============================================================
# Safe deploy script for Process Dashboard on AWS Lightsail
# (or any Linux box running Node + pm2).
#
# Usage (on the Lightsail server):
#   ./deploy.sh                              # deploy from ~/process-dashboard-app.zip
#   ./deploy.sh /path/to/new.zip             # deploy from a specific zip
#   ./deploy.sh --rollback                   # restore the most recent DB backup
#   ./deploy.sh --rollback path/to/file.db   # restore a specific backup
#
# What it does:
#   1. Atomic online backup of the live DB (via backup-cli.js)
#   2. Stops the running app
#   3. Extracts the new zip into a staging folder
#   4. Rsyncs ONLY the code into the app dir — never touches data/
#   5. npm install --omit=dev
#   6. Restarts the app and runs a health check
#
# Assumes:
#   - App lives in ~/process-dashboard-app/
#   - Runs under pm2 with process name "dashboard"
#     (if not, edit PM_* variables below — comments cover systemd too)
#   - SQLite DB at data/process-dashboard.db (default for this app)
# ============================================================

set -euo pipefail

# ---- config (edit these if your setup differs) ----
APP_DIR="$HOME/process-dashboard-app"
STAGING_DIR="$HOME/_deploy_staging"
LOG_FILE="$APP_DIR/data/backups/deploy.log"
HEALTH_URL="http://localhost:3000/login.html"

# pm2 mode (default). For systemd: replace with `sudo systemctl stop process-dashboard` etc.
PM_STOP="pm2 stop dashboard"
PM_RESTART="pm2 restart dashboard"
PM_START="pm2 start server.js --name dashboard --cwd $APP_DIR"
# ---------------------------------------------------

ts()   { date +"%Y-%m-%d %H:%M:%S"; }
log()  { mkdir -p "$(dirname "$LOG_FILE")"; echo "[$(ts)] $*" | tee -a "$LOG_FILE"; }
die()  { log "ERROR: $*"; exit 1; }

# ============================================================
# Rollback mode — restore the live DB from a backup snapshot.
# ============================================================
if [[ "${1:-}" == "--rollback" ]]; then
  cd "$APP_DIR" || die "App dir not found: $APP_DIR"
  if [[ -n "${2:-}" ]]; then
    SRC_DB="$2"
  else
    SRC_DB=$(ls -t data/backups/process-dashboard-*.db 2>/dev/null | head -1 || true)
  fi
  [[ -z "${SRC_DB:-}" ]] && die "No backups found in $APP_DIR/data/backups/"
  [[ -f "$SRC_DB" ]]     || die "Backup file not found: $SRC_DB"

  log "=== ROLLBACK ==="
  log "Restoring from: $SRC_DB"

  # Safety net: snapshot the CURRENT db before overwriting it
  PRE="data/process-dashboard.pre-rollback-$(date +%Y%m%d-%H%M%S).db"
  cp data/process-dashboard.db "$PRE" 2>/dev/null && log "Pre-rollback snapshot: $PRE"

  $PM_STOP >>"$LOG_FILE" 2>&1 || log "(app already stopped)"
  rm -f data/process-dashboard.db-wal data/process-dashboard.db-shm
  cp "$SRC_DB" data/process-dashboard.db
  $PM_RESTART >>"$LOG_FILE" 2>&1 || $PM_START >>"$LOG_FILE" 2>&1 || die "Failed to restart"
  log "✓ Rollback complete. Live DB is now: $SRC_DB"
  exit 0
fi

# ============================================================
# Normal deploy
# ============================================================
ZIP="${1:-$HOME/process-dashboard-app.zip}"
[[ -f "$ZIP"     ]] || die "Zip not found: $ZIP  (upload it with: scp ./process-dashboard-app.zip user@host:~/)"
[[ -d "$APP_DIR" ]] || die "App dir not found: $APP_DIR"
command -v node    >/dev/null || die "node not on PATH"
command -v rsync   >/dev/null || die "rsync not on PATH  (sudo apt install rsync)"
command -v unzip   >/dev/null || die "unzip not on PATH  (sudo apt install unzip)"

log "=== DEPLOY from $ZIP ==="

# Step 1: Atomic online backup of the live DB (read-only open, so no service interruption)
log "Step 1/5: backing up live DB"
( cd "$APP_DIR" && node backup-cli.js ) >>"$LOG_FILE" 2>&1 \
  || die "Backup failed — aborting deploy (no changes made)"

# Step 2: Stop the app
log "Step 2/5: stopping app"
$PM_STOP >>"$LOG_FILE" 2>&1 || log "(stop returned non-zero — maybe already stopped; continuing)"

# Step 3: Extract zip to staging, then rsync into APP_DIR excluding data/
log "Step 3/5: extracting + syncing code (excluding data/, node_modules/, .env, inputs/)"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
unzip -q -o "$ZIP" -d "$STAGING_DIR"

# Handle either zip layout: files at staging root, OR inside one wrapper folder
SRC="$STAGING_DIR"
if [[ ! -f "$SRC/server.js" ]]; then
  found=$(find "$STAGING_DIR" -maxdepth 2 -name "server.js" -type f 2>/dev/null | head -1)
  [[ -z "$found" ]] && die "server.js not found inside the zip — bad archive?"
  SRC=$(dirname "$found")
fi

rsync -av --delete \
  --exclude='data/' \
  --exclude='data/**' \
  --exclude='node_modules/' \
  --exclude='.env' \
  --exclude='inputs/' \
  --exclude='*.log' \
  --exclude='.git/' \
  "$SRC/" "$APP_DIR/" >>"$LOG_FILE" 2>&1
rm -rf "$STAGING_DIR"

# Step 4: Install deps (only production)
log "Step 4/5: npm install --omit=dev"
( cd "$APP_DIR" && npm install --omit=dev ) >>"$LOG_FILE" 2>&1 || die "npm install failed"

# Step 5: Restart and health-check
log "Step 5/5: restarting app"
$PM_RESTART >>"$LOG_FILE" 2>&1 || $PM_START >>"$LOG_FILE" 2>&1 || die "Failed to start app"

sleep 3
if curl -fsS -o /dev/null "$HEALTH_URL"; then
  log "✓ Health check passed  ($HEALTH_URL)"
  log "=== DEPLOY COMPLETE ==="
  log "Tail logs with:  pm2 logs dashboard --lines 50"
  log "If anything looks wrong, roll back with:  $0 --rollback"
else
  log "WARNING: health check failed against $HEALTH_URL"
  log "App may still be starting; check:  pm2 logs dashboard"
  log "To roll back to the last good DB:  $0 --rollback"
  exit 2
fi
