// ============================================================
// Make a clean, consistent snapshot of the LOCAL database that
// you can copy to another machine (e.g. the AWS Lightsail prod box).
//
// Uses better-sqlite3's online .backup() so it's safe to run even
// while the server is running, and it folds the WAL in — the output
// is a single self-contained .db file (no -wal / -shm needed).
//
//   node make-snapshot.js
//
// Output (stable filename, overwritten each run):
//   data/process-dashboard.snapshot.db
// ============================================================
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "process-dashboard.db");
const OUT = path.join(__dirname, "data", "process-dashboard.snapshot.db");

(async () => {
  if (!fs.existsSync(DB_PATH)) {
    console.error("Source database not found at:", DB_PATH);
    process.exit(1);
  }
  // Open read-only so we never race with / corrupt the running server.
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    await db.backup(OUT);                 // consistent, WAL-folded single file
    const size = fs.statSync(OUT).size;
    const counts = ["resources", "projects", "project_resources", "processes", "process_tasks"]
      .map(t => { try { return `${t}=${db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n}`; } catch { return null; } })
      .filter(Boolean).join("  ");
    console.log(`✓ Snapshot written: ${OUT}  (${(size / 1024).toFixed(1)} KB)`);
    console.log(`  Row counts: ${counts}`);
    console.log(`\n  Next: copy this file to the prod server (see SYNC.md).`);
    process.exit(0);
  } catch (err) {
    console.error("Snapshot FAILED:", err.message);
    process.exit(2);
  } finally {
    db.close();
  }
})();
