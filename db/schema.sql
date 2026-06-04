-- ============================================================
-- Process Dashboard — PostgreSQL schema
-- ============================================================

-- Users (for auth + audit trail)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',   -- 'admin' | 'member' | 'viewer'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PROCESSES (AI Initiative, QA, Scrum of Scrums, PM Process, Videos, Training)
-- ============================================================
CREATE TABLE IF NOT EXISTS processes (
  id           SERIAL PRIMARY KEY,
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  subtitle     TEXT,
  icon         TEXT,
  meta         TEXT,
  description  TEXT,
  sort_order   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS process_tasks (
  id          SERIAL PRIMARY KEY,
  process_id  INT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  owner       TEXT,
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'not_started',  -- not_started | in_progress | completed | blocked
  notes       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_process_tasks_process ON process_tasks(process_id);

CREATE TABLE IF NOT EXISTS task_subitems (
  id          SERIAL PRIMARY KEY,
  task_id     INT NOT NULL REFERENCES process_tasks(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_task_subitems_task ON task_subitems(task_id);

-- ============================================================
-- PROJECTS (DRS, Pulse, HOTO, Gatishakti, Cement, ...)
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  client        TEXT,
  pm            TEXT,
  tech_lead     TEXT,
  ba            TEXT,
  qa_lead       TEXT,
  sa            TEXT,
  start_date    DATE,
  go_live_date  DATE,
  notes         TEXT,
  rag_scope     TEXT NOT NULL DEFAULT 'green',   -- green | amber | red
  rag_timeline  TEXT NOT NULL DEFAULT 'green',
  rag_budget    TEXT NOT NULL DEFAULT 'green',
  rag_resources TEXT NOT NULL DEFAULT 'green',
  rag_quality   TEXT NOT NULL DEFAULT 'green',
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    INT REFERENCES users(id) ON DELETE SET NULL
);

-- Project phases (stage-gated 18-phase PDOM flow)
CREATE TABLE IF NOT EXISTS project_phases (
  id            SERIAL PRIMARY KEY,
  project_id    INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_num     INT NOT NULL,
  name          TEXT NOT NULL,
  owner         TEXT,
  approver      TEXT,
  status        TEXT NOT NULL DEFAULT 'locked',   -- locked | in_progress | completed
  notes         TEXT,
  approved_at   TIMESTAMPTZ,
  approved_by   INT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (project_id, phase_num)
);

CREATE INDEX IF NOT EXISTS idx_project_phases_project ON project_phases(project_id);

CREATE TABLE IF NOT EXISTS phase_prerequisites (
  id          SERIAL PRIMARY KEY,
  phase_id    INT NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_phase_prereqs_phase ON phase_prerequisites(phase_id);

-- ============================================================
-- AUDIT LOG (who changed what, when)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INT REFERENCES users(id) ON DELETE SET NULL,
  user_email   TEXT,
  action       TEXT NOT NULL,           -- 'create' | 'update' | 'delete' | 'approve' | 'login'
  entity_type  TEXT NOT NULL,           -- 'process_task' | 'project' | 'project_phase' | ...
  entity_id    INT,
  summary      TEXT,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON audit_log(entity_type, entity_id);

-- ============================================================
-- updated_at auto-update trigger
-- ============================================================
CREATE OR REPLACE FUNCTION trg_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS t_process_tasks_updated ON process_tasks;
CREATE TRIGGER t_process_tasks_updated BEFORE UPDATE ON process_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_updated_at();

DROP TRIGGER IF EXISTS t_projects_updated ON projects;
CREATE TRIGGER t_projects_updated BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION trg_updated_at();
