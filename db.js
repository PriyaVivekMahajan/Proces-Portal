// ============================================================
// SQLite connection (single file on disk — no server to manage)
// ============================================================
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const { STANDARD_GOVERNANCE, MATURITY_AREAS, PRINCIPLES, DEFAULT_DOC_TEMPLATES } = require("./schema");

const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "process-dashboard.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// Sensible defaults
db.pragma("journal_mode = WAL");      // multi-reader friendly
db.pragma("foreign_keys = ON");       // enforce FK constraints
db.pragma("synchronous = NORMAL");

// ---------- idempotent auto-migrations (safe on existing data) ----------
function columnExists(table, column) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column); }
  catch (e) { return false; }
}
function addColumnIfMissing(table, column, definition) {
  // Only run if the table already exists (fresh installs get it from schema.js)
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (tableExists && !columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[migrate] added column ${table}.${column}`);
  }
}

// 2026-05: per-phase assigned approver (a real user account who may sign off)
addColumnIfMissing("project_phases", "approver_user_id", "INTEGER REFERENCES users(id) ON DELETE SET NULL");

// 2026-05: sprints (global — shared across all processes; any task can join)
db.exec(`CREATE TABLE IF NOT EXISTS sprints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  start_date  TEXT,
  end_date    TEXT,
  goal        TEXT,
  status      TEXT NOT NULL DEFAULT 'planned',
  sort_order  INTEGER NOT NULL DEFAULT 0
);`);
addColumnIfMissing("process_tasks", "sprint_id", "INTEGER REFERENCES sprints(id) ON DELETE SET NULL");

// 2026-05: migrate sprints from per-process to global (drop process_id), preserving data
if (columnExists("sprints", "process_id")) {
  db.pragma("foreign_keys = OFF");
  const rebuild = db.transaction(() => {
    db.exec(`CREATE TABLE sprints_global (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      goal TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      sort_order INTEGER NOT NULL DEFAULT 0
    );`);
    db.exec(`INSERT INTO sprints_global (id,name,start_date,end_date,goal,status,sort_order)
             SELECT id,name,start_date,end_date,goal,status,sort_order FROM sprints;`);
    db.exec(`DROP TABLE sprints;`);
    db.exec(`ALTER TABLE sprints_global RENAME TO sprints;`);
  });
  rebuild();
  db.pragma("foreign_keys = ON");
  console.log("[migrate] sprints are now global (removed process_id; data preserved)");
}

// 2026-05: editable project plan grid (flexible columns + rows)
addColumnIfMissing("projects", "plan_columns", "TEXT");
// 2026-05: optional OneDrive/SharePoint Excel embed URL per project
addColumnIfMissing("projects", "plan_excel_url", "TEXT");
db.exec(`CREATE TABLE IF NOT EXISTS project_plan_rows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  cells       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_project_plan_rows_project ON project_plan_rows(project_id);`);

// 2026-05: project governance checklist
db.exec(`CREATE TABLE IF NOT EXISTS project_governance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'not_started',
  owner       TEXT,
  due_date    TEXT,
  link        TEXT,
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_project_governance_project ON project_governance(project_id);`);

// Backfill standard governance items for existing projects that have none.
try {
  const projectsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
  if (projectsTable) {
    const projs = db.prepare("SELECT id FROM projects").all();
    const insGov = db.prepare("INSERT INTO project_governance (project_id,title,sort_order) VALUES (?,?,?)");
    const backfill = db.transaction(() => {
      let filled = 0;
      for (const p of projs) {
        const has = db.prepare("SELECT COUNT(*) AS n FROM project_governance WHERE project_id = ?").get(p.id).n;
        if (has === 0) { STANDARD_GOVERNANCE.forEach((t, i) => insGov.run(p.id, t, i)); filled++; }
      }
      return filled;
    });
    const n = backfill();
    if (n > 0) console.log(`[migrate] seeded governance checklist for ${n} existing project(s)`);
  }
} catch (e) { console.error("[migrate] governance backfill failed:", e.message); }

// 2026-05: Delivery Maturity matrix (8 areas, current vs target level 1-5)
db.exec(`CREATE TABLE IF NOT EXISTS maturity_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  current_level INTEGER NOT NULL DEFAULT 1,
  target_level INTEGER NOT NULL DEFAULT 3,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);`);
if (db.prepare("SELECT COUNT(*) AS n FROM maturity_areas").get().n === 0) {
  const ins = db.prepare("INSERT INTO maturity_areas (name,current_level,target_level,notes,sort_order) VALUES (?,?,?,?,?)");
  db.transaction(() => MATURITY_AREAS.forEach((m, i) => ins.run(m.name, m.current_level, m.target_level, m.notes, i)))();
  console.log(`[migrate] seeded ${MATURITY_AREAS.length} maturity areas`);
}

// 2026-05: Partnership Principles
db.exec(`CREATE TABLE IF NOT EXISTS principles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  num INTEGER,
  title TEXT NOT NULL,
  body TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);`);
if (db.prepare("SELECT COUNT(*) AS n FROM principles").get().n === 0) {
  const ins = db.prepare("INSERT INTO principles (num,title,body,sort_order) VALUES (?,?,?,?)");
  db.transaction(() => PRINCIPLES.forEach((p, i) => ins.run(p.num, p.title, p.body, i)))();
  console.log(`[migrate] seeded ${PRINCIPLES.length} partnership principles`);
}

// 2026-05: Document templates library (titles + URLs to OneDrive/SharePoint templates)
db.exec(`CREATE TABLE IF NOT EXISTS document_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT,
  description TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);`);
if (db.prepare("SELECT COUNT(*) AS n FROM document_templates").get().n === 0) {
  const ins = db.prepare("INSERT INTO document_templates (icon,title,description,sort_order) VALUES (?,?,?,?)");
  db.transaction(() => DEFAULT_DOC_TEMPLATES.forEach((t, i) => ins.run(t.icon, t.title, t.description, i)))();
  console.log(`[migrate] seeded ${DEFAULT_DOC_TEMPLATES.length} document templates (URLs empty until you fill them in)`);
}

module.exports = db;
