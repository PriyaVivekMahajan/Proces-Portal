// ============================================================
// Database schema (SQLite)
// Run via: node migrate.js
// ============================================================
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS processes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  icon         TEXT,
  meta         TEXT,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sprints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  start_date  TEXT,
  end_date    TEXT,
  goal        TEXT,
  status      TEXT NOT NULL DEFAULT 'planned',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS process_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id  INTEGER NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  sprint_id   INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  owner       TEXT,
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'not_started',
  notes       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_process_tasks_process ON process_tasks(process_id);
CREATE INDEX IF NOT EXISTS idx_process_tasks_sprint ON process_tasks(sprint_id);

CREATE TABLE IF NOT EXISTS task_subitems (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES process_tasks(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_task_subitems_task ON task_subitems(task_id);

CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  client        TEXT,
  pm            TEXT,
  tech_lead     TEXT,
  ba            TEXT,
  qa_lead       TEXT,
  sa            TEXT,
  start_date    TEXT,
  go_live_date  TEXT,
  notes         TEXT,
  rag_scope     TEXT NOT NULL DEFAULT 'green',
  rag_timeline  TEXT NOT NULL DEFAULT 'green',
  rag_budget    TEXT NOT NULL DEFAULT 'green',
  rag_resources TEXT NOT NULL DEFAULT 'green',
  rag_quality   TEXT NOT NULL DEFAULT 'green',
  plan_columns  TEXT,
  plan_excel_url TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_plan_rows (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  cells       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_project_plan_rows_project ON project_plan_rows(project_id);

CREATE TABLE IF NOT EXISTS project_phases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_num   INTEGER NOT NULL,
  name        TEXT NOT NULL,
  owner       TEXT,
  approver    TEXT,
  status      TEXT NOT NULL DEFAULT 'locked',
  notes       TEXT,
  approver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (project_id, phase_num)
);
CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id);

CREATE TABLE IF NOT EXISTS phase_prerequisites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id   INTEGER NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_phase_prereqs_phase ON phase_prerequisites(phase_id);

CREATE TABLE IF NOT EXISTS project_governance (
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
CREATE INDEX IF NOT EXISTS idx_project_governance_project ON project_governance(project_id);

CREATE TABLE IF NOT EXISTS document_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  url         TEXT,
  description TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS maturity_areas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  current_level INTEGER NOT NULL DEFAULT 1,
  target_level  INTEGER NOT NULL DEFAULT 3,
  notes         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS principles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  num         INTEGER,
  title       TEXT NOT NULL,
  body        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  summary     TEXT,
  payload     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON audit_log(entity_type, entity_id);
`;

// Standard governance checklist seeded onto every project (editable per project afterwards)
const STANDARD_GOVERNANCE = [
  "Project Plan",
  "SRS (Software Requirements Spec)",
  "CR (Change Requests)",
  "SOW Sign-off",
  "Project Kickoff",
  "Resource Allocation",
  "Azure Boards setup",
  "Weekly Governance — Internal",
  "Weekly Governance — Client (External)"
];

// Seed data for the 8 maturity areas (from Delivery Process Maturity matrix)
const MATURITY_AREAS = [
  { name: "Requirements & Scoping",  current_level: 1, target_level: 3, notes: "No formal BA-led process. Root cause of scope creep." },
  { name: "Estimation & Sizing",     current_level: 1, target_level: 3, notes: "No estimation framework. CStech was sized wrong." },
  { name: "Architecture & Design",   current_level: 2, target_level: 4, notes: "Good project-by-project, but no reusable templates." },
  { name: "Sprint Execution",        current_level: 3, target_level: 4, notes: "Dev teams deliver well. Strongest area." },
  { name: "QA & Testing",            current_level: 1, target_level: 3, notes: "QA thin (4 people across 6 projects). No automation." },
  { name: "Change Control",          current_level: 1, target_level: 3, notes: "No formal change request process. Scope creep accepted." },
  { name: "Client Communication",    current_level: 2, target_level: 3, notes: "Improved after Ahmedabad move. Still inconsistent." },
  { name: "Post Go-Live",            current_level: 1, target_level: 3, notes: "Almost non-existent. DRS AMC is first attempt." }
];

// Adani's 5 Partnership Principles
const PRINCIPLES = [
  { num: 1, title: "Business-First Mindset",       body: "Solutions must originate from Adani's operational realities — not technology showcases. Invest time in domain, asset scale, and decision cycles." },
  { num: 2, title: "Co-Creation over Customization", body: "Jointly design scalable, reusable building blocks — platform-led, modular, future-ready. IP creation, not one-off implementations." },
  { num: 3, title: "Outcome Ownership",            body: "Align to clear business KPIs. Remain accountable beyond go-live — support adoption, value realization, and continuous improvement." },
  { num: 4, title: "Enterprise-Grade Thinking",    body: "Solutions must be secured, resilient, cloud-native, compliant with Adani's enterprise architecture. Ready to scale." },
  { num: 5, title: "Long-Term Roadmap Mindset",    body: "Proactively bring ideas, emerging technologies, and phased roadmaps aligned to Adani's multi-year digital transformation vision." }
];

// Default document template entries (titles only; users paste their own OneDrive/SharePoint URLs)
const DEFAULT_DOC_TEMPLATES = [
  { icon: "📄", title: "Project Plan Template",       description: "Master project plan / WBS in Excel" },
  { icon: "📋", title: "SRS Template",                 description: "Software Requirements Specification" },
  { icon: "🔄", title: "Change Request (CR) Template", description: "CR document template" },
  { icon: "📜", title: "SOW Template",                 description: "Statement of Work" },
  { icon: "🚀", title: "Kickoff Deck Template",        description: "Project kickoff slides" },
  { icon: "👥", title: "Resource Allocation Sheet",    description: "Team & role allocation" },
  { icon: "📝", title: "FSD Template",                 description: "Functional Specification Document" },
  { icon: "🧪", title: "Test Plan Template",           description: "QA test plan" },
  { icon: "✅", title: "UAT Sign-off Template",        description: "Client UAT confirmation" },
  { icon: "📊", title: "Weekly Status Report",         description: "Weekly governance / status template" },
  { icon: "🛡", title: "CMF Template",                  description: "Change Management Form" },
  { icon: "📦", title: "Migration Plan Template",      description: "Production migration & rollback plan" }
];

module.exports = { SCHEMA_SQL, STANDARD_GOVERNANCE, MATURITY_AREAS, PRINCIPLES, DEFAULT_DOC_TEMPLATES };
