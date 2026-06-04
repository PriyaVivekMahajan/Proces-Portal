// ============================================================
// Standalone backup CLI — safe even if the main server is stopped.
// Run via:  node backup-cli.js
// Uses better-sqlite3's online backup API so a running server can't
// produce a half-written snapshot.
// ============================================================
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "data", "process-dashboard.db");
const BACKUP_DIR = path.join(__dirname, "data", "backups");

function pad(n) { return String(n).padStart(2, "0"); }
function stampedName() {
  const d = new Date();
  return `process-dashboard-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`;
}

(async () => {
  if (!fs.existsSync(DB_PATH)) {
    console.error("Database not found at:", DB_PATH);
    process.exit(1);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, stampedName());
  // Open read-only so we don't race with the running server.
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
    const size = fs.statSync(dest).size;
    console.log(`[backup-cli] OK  ${dest}  (${(size/1024).toFixed(1)} KB)`);
    process.exit(0);
  } catch (err) {
    console.error("[backup-cli] FAILED:", err.message);
    process.exit(2);
  } finally {
    db.close();
  }
})();
