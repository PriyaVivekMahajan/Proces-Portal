// ============================================================
// Express server — REST API + serves the frontend
// ============================================================
require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const db = require("./db");
const { STANDARD_GOVERNANCE } = require("./schema");

const LIFECYCLE_15_TEMPLATE = [
  // Phase 1 — Discovery & Scoping
  { name: "1. Business Problem Articulation", owner: "BA Lead",  approver: "Product Owner",   prerequisites: ["Stakeholder interviews completed"] },
  { name: "2. Stakeholder Alignment",         owner: "BA Lead",  approver: "Product Owner",   prerequisites: ["RACI agreed", "Decision-makers identified"] },
  { name: "3. As-Is Assessment",              owner: "BA Lead",  approver: "Solution Architect", prerequisites: ["Current-state walkthrough done"] },
  { name: "4. Solution Hypothesis",           owner: "Solution Architect", approver: "Solution Architect", prerequisites: ["Hypothesis reviewed with client"] },
  { name: "5. Scope & Effort Estimation",     owner: "PM",       approver: "Delivery Head",   prerequisites: ["Estimation reviewed", "SOW drafted"] },
  // Phase 2 — Build & Deliver
  { name: "6. Architecture & Design",         owner: "Dev Lead", approver: "Solution Architect", prerequisites: ["FSD sign-off"] },
  { name: "7. Development Sprints",           owner: "Dev Lead", approver: "Dev Lead",        prerequisites: ["Sprint plan approved"] },
  { name: "8. QA & Testing",                  owner: "QA Manager", approver: "QA Manager",    prerequisites: ["Test plan approved"] },
  { name: "9. UAT",                           owner: "QA Manager", approver: "Client",        prerequisites: ["UAT deployment", "Client UAT scheduled"] },
  { name: "10. Go-Live",                      owner: "Deployment Lead", approver: "Delivery Head", prerequisites: ["CAB approval", "Production downtime approved"] },
  // Phase 3 — Sustain & Scale
  { name: "11. Hypercare & Stabilization",    owner: "Deployment Lead", approver: "Delivery Head", prerequisites: ["Hypercare plan agreed"] },
  { name: "12. Adoption Tracking",            owner: "BA Lead",  approver: "Product Owner",   prerequisites: ["Adoption KPIs defined"] },
  { name: "13. Value Realization Report",     owner: "PM",       approver: "Client",          prerequisites: ["Baseline vs actuals captured"] },
  { name: "14. AMC & Continuous Improvement", owner: "PM",       approver: "Delivery Head",   prerequisites: ["AMC contract in place"] },
  { name: "15. Roadmap for Next Phase",       owner: "Solution Architect", approver: "Client", prerequisites: ["Roadmap reviewed with client"] }
];

// ---------- BACKUP ENGINE (atomic, online) ----------
const BACKUP_DIR = path.join(__dirname, "data", "backups");
function ensureBackupDir() { try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (e) {} }
function backupNow(reason) {
  ensureBackupDir();
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15).replace("T", "-"); // YYYYMMDD-HHMMSS-ish
  const ts = new Date();
  const pad = n => String(n).padStart(2, "0");
  const filename = `process-dashboard-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.db`;
  const dest = path.join(BACKUP_DIR, filename);
  try {
    // better-sqlite3's .backup() is atomic, online, and safe with concurrent reads/writes.
    const p = db.backup(dest);
    // .backup() returns a Promise in better-sqlite3
    return Promise.resolve(p).then(() => {
      console.log(`[backup] ${reason || "manual"} → ${filename}`);
      try { db.prepare(`INSERT INTO audit_log (user_id,user_email,action,entity_type,entity_id,summary,payload)
                       VALUES (NULL,?,?,?,?,?,?)`)
        .run("system", "backup", "database", null, `Backup created (${reason || "manual"}) → ${filename}`, null); } catch (e) {}
      return { ok: true, file: filename };
    }).catch(err => { console.error("[backup] FAILED:", err.message); return { ok: false, error: err.message }; });
  } catch (err) {
    console.error("[backup] FAILED:", err.message);
    return Promise.resolve({ ok: false, error: err.message });
  }
}

function msUntilNext11pm() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}
function scheduleDailyBackup() {
  const delay = msUntilNext11pm();
  setTimeout(async () => {
    await backupNow("daily-11pm");
    setInterval(() => backupNow("daily-11pm"), 24 * 60 * 60 * 1000);
  }, delay);
  const next = new Date(Date.now() + delay);
  console.log(`  Daily backup scheduled for ${next.toLocaleString()} and every 24h after.`);
}

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ---------- helpers ----------
function audit(user, action, entityType, entityId, summary, payload) {
  try {
    db.prepare(`INSERT INTO audit_log (user_id,user_email,action,entity_type,entity_id,summary,payload)
                VALUES (?,?,?,?,?,?,?)`)
      .run(user?.id || null, user?.email || null, action, entityType, entityId || null, summary || null, payload ? JSON.stringify(payload) : null);
  } catch (e) { console.error("audit failed:", e.message); }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT id,email,name,role FROM users WHERE id = ?").get(decoded.id);
    if (!user) return res.status(401).json({ error: "Invalid session" });
    req.user = user;
    next();
  } catch (e) { return res.status(401).json({ error: "Invalid or expired session" }); }
}

// ---------- AUTH ----------
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const user = db.prepare("SELECT id,email,password_hash,name,role FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 });
  audit(user, "login", "user", user.id, "Logged in");
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post("/api/auth/signup", async (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !name || !password || password.length < 6) return res.status(400).json({ error: "Email, name and password (min 6 chars) required" });
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: "Email already registered" });
  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare("INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)")
    .run(email.toLowerCase(), hash, name, "member");
  const user = { id: result.lastInsertRowid, email: email.toLowerCase(), name, role: "member" };
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 });
  audit(user, "signup", "user", user.id, "Created account");
  res.json({ user });
});

app.post("/api/auth/logout", (req, res) => { res.clearCookie("token"); res.json({ ok: true }); });

app.get("/api/auth/me", requireAuth, (req, res) => { res.json({ user: req.user }); });

// ---------- USERS ----------
app.get("/api/users", requireAuth, (req, res) => {
  const users = db.prepare("SELECT id,email,name,role FROM users ORDER BY name COLLATE NOCASE").all();
  res.json(users);
});

// ---------- PROCESS CREATE / UPDATE / DELETE ----------
app.post("/api/processes", requireAuth, (req, res) => {
  const { title, subtitle, icon, meta, description } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Process title required" });
  let slug = slugify(title);
  let suffix = 1;
  while (db.prepare("SELECT id FROM processes WHERE slug = ?").get(slug)) { slug = slugify(title) + "-" + (++suffix); }
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM processes").get().m;
  const r = db.prepare(`INSERT INTO processes (slug,title,subtitle,icon,meta,description,sort_order)
                        VALUES (?,?,?,?,?,?,?)`)
    .run(slug, title.trim(), subtitle || null, icon || null, meta || null, description || null, maxOrder + 1);
  audit(req.user, "create", "process", r.lastInsertRowid, `Created process "${title}"`);
  res.json({ id: r.lastInsertRowid, slug });
});

app.patch("/api/processes/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const fields = ["title", "subtitle", "icon", "meta", "description"];
  const updates = [], values = [];
  fields.forEach(f => { if (req.body && f in req.body) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE processes SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  audit(req.user, "update", "process", id, `Updated process #${id}`, req.body);
  res.json({ ok: true });
});

app.delete("/api/processes/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const p = db.prepare("SELECT title FROM processes WHERE id = ?").get(id);
  if (!p) return res.status(404).json({ error: "Process not found" });
  db.prepare("DELETE FROM processes WHERE id = ?").run(id);
  audit(req.user, "delete", "process", id, `Deleted process "${p.title}"`);
  res.json({ ok: true });
});

// ---------- PROCESSES + TASKS ----------
app.get("/api/processes", requireAuth, (req, res) => {
  const processes = db.prepare("SELECT * FROM processes ORDER BY sort_order, id").all();
  const tasks = db.prepare("SELECT * FROM process_tasks ORDER BY sort_order, id").all();
  const subs = db.prepare("SELECT * FROM task_subitems ORDER BY sort_order, id").all();
  const subsByTask = subs.reduce((a,s)=>{ (a[s.task_id]=a[s.task_id]||[]).push({id:s.id, text:s.text, done:!!s.done}); return a; }, {});
  const tasksByProcess = tasks.reduce((a,t)=>{
    (a[t.process_id]=a[t.process_id]||[]).push({ ...t, due_date: t.due_date || "", notes: t.notes || "", owner: t.owner || "", subitems: subsByTask[t.id] || [] });
    return a;
  }, {});
  res.json(processes.map(p => ({ ...p, tasks: tasksByProcess[p.id] || [] })));
});

app.patch("/api/tasks/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const { title, owner, due_date, status, notes } = req.body || {};
  const t = db.prepare("SELECT * FROM process_tasks WHERE id = ?").get(id);
  if (!t) return res.status(404).json({ error: "Task not found" });
  db.prepare(`UPDATE process_tasks SET
    title = COALESCE(?, title),
    owner = COALESCE(?, owner),
    due_date = COALESCE(?, due_date),
    status = COALESCE(?, status),
    notes = COALESCE(?, notes),
    updated_at = datetime('now'),
    updated_by = ?
    WHERE id = ?`).run(title ?? null, owner ?? null, due_date ?? null, status ?? null, notes ?? null, req.user.id, id);
  // sprint_id handled explicitly so null (= move to Backlog) is honored
  if (req.body && "sprint_id" in req.body) {
    const sid = req.body.sprint_id ? +req.body.sprint_id : null;
    db.prepare("UPDATE process_tasks SET sprint_id = ? WHERE id = ?").run(sid, id);
  }
  audit(req.user, "update", "process_task", id, `Updated task #${id}`, req.body);
  res.json({ ok: true });
});

app.post("/api/processes/:id/tasks", requireAuth, (req, res) => {
  const procId = +req.params.id;
  const { title, sprint_id } = req.body || {};
  const sid = sprint_id ? +sprint_id : null;
  const result = db.prepare("INSERT INTO process_tasks (process_id,sprint_id,title,status,updated_by) VALUES (?,?,?,?,?)")
    .run(procId, sid, title || "New task", "not_started", req.user.id);
  audit(req.user, "create", "process_task", result.lastInsertRowid, `Created task in process #${procId}`);
  res.json({ id: result.lastInsertRowid });
});

app.delete("/api/tasks/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  db.prepare("DELETE FROM process_tasks WHERE id = ?").run(id);
  audit(req.user, "delete", "process_task", id, `Deleted task #${id}`);
  res.json({ ok: true });
});

app.post("/api/tasks/:id/subitems", requireAuth, (req, res) => {
  const id = +req.params.id;
  const { text } = req.body || {};
  const r = db.prepare("INSERT INTO task_subitems (task_id,text,done) VALUES (?,?,0)").run(id, text || "New sub-action");
  audit(req.user, "create", "task_subitem", r.lastInsertRowid, `Added sub-item to task #${id}`);
  res.json({ id: r.lastInsertRowid });
});

app.patch("/api/subitems/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const { text, done } = req.body || {};
  db.prepare("UPDATE task_subitems SET text = COALESCE(?, text), done = COALESCE(?, done) WHERE id = ?")
    .run(text ?? null, done === undefined ? null : (done ? 1 : 0), id);
  res.json({ ok: true });
});

app.delete("/api/subitems/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM task_subitems WHERE id = ?").run(+req.params.id);
  res.json({ ok: true });
});

// ---------- SPRINTS (global — shared across all processes) ----------
app.get("/api/sprints", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM sprints ORDER BY sort_order, id").all());
});

app.post("/api/sprints", requireAuth, (req, res) => {
  const { name, start_date, end_date, goal, status } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Sprint name required" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM sprints").get().m;
  const r = db.prepare("INSERT INTO sprints (name,start_date,end_date,goal,status,sort_order) VALUES (?,?,?,?,?,?)")
    .run(name.trim(), start_date || null, end_date || null, goal || null, status || "planned", maxOrder + 1);
  audit(req.user, "create", "sprint", r.lastInsertRowid, `Created sprint "${name}"`);
  res.json({ id: r.lastInsertRowid });
});

app.patch("/api/sprints/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const fields = ["name", "start_date", "end_date", "goal", "status"];
  const updates = [], values = [];
  fields.forEach(f => { if (req.body && f in req.body) { updates.push(`${f} = ?`); values.push(req.body[f] === "" ? null : req.body[f]); } });
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE sprints SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  audit(req.user, "update", "sprint", id, `Updated sprint #${id}`, req.body);
  res.json({ ok: true });
});

app.delete("/api/sprints/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const s = db.prepare("SELECT name FROM sprints WHERE id = ?").get(id);
  if (!s) return res.status(404).json({ error: "Sprint not found" });
  // tasks keep existing — sprint_id is set to NULL by the FK (ON DELETE SET NULL), moving them to Backlog
  db.prepare("DELETE FROM sprints WHERE id = ?").run(id);
  audit(req.user, "delete", "sprint", id, `Deleted sprint "${s.name}" (tasks moved to Backlog)`);
  res.json({ ok: true });
});

// ---------- PROJECTS + PHASES ----------
app.get("/api/projects", requireAuth, (req, res) => {
  const projects = db.prepare("SELECT * FROM projects ORDER BY sort_order, id").all();
  const phases = db.prepare("SELECT * FROM project_phases ORDER BY project_id, phase_num").all();
  const prereqs = db.prepare("SELECT * FROM phase_prerequisites ORDER BY sort_order, id").all();
  const governance = db.prepare("SELECT * FROM project_governance ORDER BY sort_order, id").all();
  const preqByPhase = prereqs.reduce((a,p)=>{ (a[p.phase_id]=a[p.phase_id]||[]).push({id:p.id, text:p.text, done:!!p.done}); return a; }, {});
  const phasesByProj = phases.reduce((a,p)=>{
    (a[p.project_id]=a[p.project_id]||[]).push({ ...p, prerequisites: preqByPhase[p.id] || [] });
    return a;
  }, {});
  const govByProj = governance.reduce((a,g)=>{ (a[g.project_id]=a[g.project_id]||[]).push(g); return a; }, {});
  res.json(projects.map(p => ({ ...p, phases: phasesByProj[p.id] || [], governance: govByProj[p.id] || [] })));
});

app.patch("/api/projects/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const fields = ["name","client","pm","tech_lead","ba","qa_lead","sa","start_date","go_live_date","notes","rag_scope","rag_timeline","rag_budget","rag_resources","rag_quality","plan_excel_url"];
  const updates = [], values = [];
  fields.forEach(f => { if (req.body && f in req.body) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE projects SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...values);
  audit(req.user, "update", "project", id, `Updated project #${id}`, req.body);
  res.json({ ok: true });
});

app.patch("/api/phases/:id/prerequisites/:pid", requireAuth, (req, res) => {
  const phaseId = +req.params.id;
  const preqId = +req.params.pid;
  const { done } = req.body || {};
  // ensure phase is in_progress
  const ph = db.prepare("SELECT * FROM project_phases WHERE id = ?").get(phaseId);
  if (!ph) return res.status(404).json({ error: "Phase not found" });
  if (ph.status !== "in_progress") return res.status(409).json({ error: "Phase is not in progress" });
  db.prepare("UPDATE phase_prerequisites SET done = ? WHERE id = ? AND phase_id = ?").run(done ? 1 : 0, preqId, phaseId);
  res.json({ ok: true });
});

app.post("/api/phases/:id/approve", requireAuth, (req, res) => {
  const phaseId = +req.params.id;
  const ph = db.prepare("SELECT * FROM project_phases WHERE id = ?").get(phaseId);
  if (!ph) return res.status(404).json({ error: "Phase not found" });
  if (ph.status !== "in_progress") return res.status(409).json({ error: "Phase is not in progress" });
  // If a specific approver is assigned, only that user may approve (no admin override).
  if (ph.approver_user_id && ph.approver_user_id !== req.user.id) {
    const assignee = db.prepare("SELECT name FROM users WHERE id = ?").get(ph.approver_user_id);
    return res.status(403).json({ error: `Only the assigned approver${assignee ? ` (${assignee.name})` : ""} can approve this phase` });
  }
  const unmet = db.prepare("SELECT COUNT(*) AS n FROM phase_prerequisites WHERE phase_id = ? AND done = 0").get(phaseId).n;
  if (unmet > 0) return res.status(400).json({ error: `${unmet} prerequisite(s) not yet complete` });

  const tx = db.transaction(() => {
    db.prepare("UPDATE project_phases SET status='completed', approved_at=datetime('now'), approved_by=? WHERE id=?").run(req.user.id, phaseId);
    const next = db.prepare("SELECT id FROM project_phases WHERE project_id = ? AND phase_num = ?").get(ph.project_id, ph.phase_num + 1);
    if (next) db.prepare("UPDATE project_phases SET status='in_progress' WHERE id=?").run(next.id);
  });
  tx();
  audit(req.user, "approve", "project_phase", phaseId, `Approved phase "${ph.name}" (#${ph.phase_num})`);
  res.json({ ok: true });
});

// ---------- PROJECT CREATE / DELETE ----------
// PDOM Normal CR — 20 phases — sourced from inputs/Project Process Management.xlsx (sheet "Normal CR")
// Phases tagged with iterate:"sprint" get duplicated N times per dev_sprints input; iterate:"uat" by uat_rounds.
const PDOM_PHASE_TEMPLATE = [
  { name: "Create Epic",                              owner: "Product Owner",     approver: "Product Owner",     prerequisites: ["Azure access"] },
  { name: "Create Feature",                           owner: "Product Owner",     approver: "Product Owner",     prerequisites: ["Approved BRD"] },
  { name: "BRD & Artifacts",                          owner: "Product Owner",     approver: "Product Owner",     prerequisites: ["BRD prepared", "Project Plan attached", "SOW signed"] },
  { name: "Project Kick-Off",                         owner: "Product Owner",     approver: "Product Owner",     prerequisites: ["Signed BRD"] },
  { name: "FSD Preparation",                          owner: "BA Lead",           approver: "BA Lead",           prerequisites: ["Approved BRD"] },
  { name: "FSD Walkthrough",                          owner: "BA Lead",           approver: "BA Lead",           prerequisites: ["FSD ready"] },
  { name: "Design",                                   owner: "Dev Lead",          approver: "Solution Architect", prerequisites: ["FSD sign-off"] },
  { name: "Development",                              owner: "Dev Lead",          approver: "Dev Lead",          prerequisites: ["Approved Design"], iterate: "sprint" },
  { name: "Code Review",                              owner: "Dev Lead",          approver: "Solution Architect", prerequisites: ["Development completed"] },
  { name: "CMF Walkthrough",                          owner: "Change Manager",    approver: "Change Manager",    prerequisites: ["Implementation Plan", "Impact Assessment", "CMF document"] },
  { name: "SIT Code Migration",                       owner: "Dev Lead",          approver: "Dev Lead",          prerequisites: ["Approved CMF"] },
  { name: "SIT Testing",                              owner: "QA Manager",        approver: "QA Manager",        prerequisites: ["SIT deployment"] },
  { name: "UAT Code Migration",                       owner: "Dev Lead",          approver: "Dev Lead",          prerequisites: ["SIT sign-off"] },
  { name: "UAT",                                      owner: "QA Manager",        approver: "Client",            prerequisites: ["UAT deployment"], iterate: "uat" },
  { name: "Finalization (Code Commit)",               owner: "Solution Architect", approver: "Solution Architect", prerequisites: ["UAT sign-off"] },
  { name: "Production Migration & Checklist Review",  owner: "Dev Lead",          approver: "Product Owner",     prerequisites: ["Approved CMF", "UAT Sign-off"] },
  { name: "User Verification Test",                   owner: "Product Owner",     approver: "Product Owner",     prerequisites: ["Production deployment"] },
  { name: "Code Synchronization",                     owner: "Dev Lead",          approver: "Dev Lead",          prerequisites: ["Production stable"] },
  { name: "Project Handover",                         owner: "Change Manager",    approver: "Change Manager",    prerequisites: ["Client sign-off"] },
  { name: "Project Closure",                          owner: "Change Manager",    approver: "Change Manager",    prerequisites: ["Client approval"] }
];

// PDOM Unscheduled — 22 phases — from sheet "Unscheduled"
const UNSCHEDULED_TEMPLATE = [
  { name: "Create Project",                           owner: "Project Manager",   approver: "Project Manager",   prerequisites: ["System access"] },
  { name: "BRD and Artifacts",                        owner: "Project Manager",   approver: "Project Manager",   prerequisites: ["BRD"] },
  { name: "Project Kick-Off",                         owner: "Project Manager",   approver: "Project Manager",   prerequisites: ["BRD"] },
  { name: "FSD Document Preparation",                 owner: "BA Team",           approver: "BA Lead",           prerequisites: ["Approved BRD"] },
  { name: "FSD Walkthrough",                          owner: "BA Lead",           approver: "BA Lead",           prerequisites: ["FSD"] },
  { name: "Design",                                   owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["FSD sign-off"] },
  { name: "Source Checkout (If Applicable)",          owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["Source code availability"] },
  { name: "Development",                              owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["Approved Design"], iterate: "sprint" },
  { name: "Code Review",                              owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["Development completed"] },
  { name: "Change Walkthrough",                       owner: "Change Manager",    approver: "Change Manager",    prerequisites: ["Implementation Plan", "Impact Assessment", "Change Document"] },
  { name: "SIT Code Migration",                       owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["Approved Change Document"] },
  { name: "SIT Testing",                              owner: "QA Manager",        approver: "QA Manager",        prerequisites: ["SIT deployment"] },
  { name: "UAT Code Migration",                       owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["SIT sign-off"] },
  { name: "UAT",                                      owner: "QA Manager",        approver: "Client",            prerequisites: ["UAT deployment"], iterate: "uat" },
  { name: "Testing Sign-off",                         owner: "QA Manager",        approver: "Client",            prerequisites: ["Test completion", "Client confirmation"] },
  { name: "Change Approval Board (CAB)",              owner: "Change Manager",    approver: "CAB",               prerequisites: ["SIT sign-off", "UAT sign-off", "Client approval", "Migration plan"] },
  { name: "Finalization",                             owner: "Solution Architect", approver: "Solution Architect", prerequisites: ["CAB approval"] },
  { name: "Production Migration",                     owner: "Deployment Lead",   approver: "Deployment Lead",   prerequisites: ["Approved migration plan"] },
  { name: "User Verification Test",                   owner: "Deployment Lead",   approver: "Client",            prerequisites: ["Production deployment"] },
  { name: "Code Synchronization (Primary to Secondary)", owner: "Deployment Lead", approver: "Deployment Lead",   prerequisites: ["Production stabilized"] },
  { name: "Project Closure Initiation",               owner: "Change Manager",    approver: "Client",            prerequisites: ["Client sign-off"] },
  { name: "Project Closed",                           owner: "Change Manager",    approver: "Change Manager",    prerequisites: ["Formal closure approval"] }
];

// PDOM Bug Fix — 16 phases — from sheet "Bug Fix"
const BUG_FIX_TEMPLATE = [
  { name: "Create Project",                           owner: "Project Manager",   approver: "Project Manager",   prerequisites: ["System access"] },
  { name: "Design",                                   owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["Approved requirement"] },
  { name: "Source Checkout (If Applicable)",          owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["Source code availability"] },
  { name: "Development",                              owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["Approved Design"], iterate: "sprint" },
  { name: "Code Review",                              owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["Development completed"] },
  { name: "SIT Code Migration",                       owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["Implementation Plan", "Impact Assessment", "Change Document"] },
  { name: "SIT Testing",                              owner: "QA Manager",        approver: "QA Manager",        prerequisites: ["SIT deployment"] },
  { name: "UAT Code Migration",                       owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["SIT sign-off"] },
  { name: "UAT",                                      owner: "QA Manager",        approver: "Client",            prerequisites: ["UAT deployment"], iterate: "uat" },
  { name: "Test Sign-Off",                            owner: "QA Manager",        approver: "Client",            prerequisites: ["Test completion", "Client confirmation"] },
  { name: "Finalization",                             owner: "Solution Architect", approver: "Solution Architect", prerequisites: ["Test sign-off"] },
  { name: "Production Migration",                     owner: "Deployment Lead",   approver: "Deployment Lead",   prerequisites: ["Approved migration plan"] },
  { name: "User Verification Test",                   owner: "Deployment Lead",   approver: "Client",            prerequisites: ["Production deployment"] },
  { name: "Code Synchronization (Primary to Secondary)", owner: "Deployment Lead", approver: "Deployment Lead",   prerequisites: ["Production stabilized"] },
  { name: "Project Closure Initiation",               owner: "Change Manager",    approver: "Client",            prerequisites: ["Client sign-off"] },
  { name: "Project Closed",                           owner: "Change Manager",    approver: "Change Manager",    prerequisites: ["Formal closure approval"] }
];

// PDOM Emergency Change — 18 phases — from sheet "Emergency Change"
const EMERGENCY_TEMPLATE = [
  { name: "Create Project",                           owner: "Project Manager",   approver: "Project Manager",   prerequisites: ["System access"] },
  { name: "BRD & Artifacts",                          owner: "Project Manager",   approver: "Project Manager",   prerequisites: ["Approved BRD"] },
  { name: "Design",                                   owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["FSD sign-off (Client & BA)"] },
  { name: "Source Checkout (If Applicable)",          owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["Source code availability"] },
  { name: "Development",                              owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["Approved Design"], iterate: "sprint" },
  { name: "Code Review",                              owner: "Technical Lead",    approver: "Solution Architect", prerequisites: ["Development completed"] },
  { name: "SIT Code Migration",                       owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["Implementation Plan", "Impact Assessment", "Change Document"] },
  { name: "SIT Testing",                              owner: "QA Manager",        approver: "QA Manager",        prerequisites: ["SIT deployment"] },
  { name: "UAT Code Migration",                       owner: "Technical Lead",    approver: "Technical Lead",    prerequisites: ["SIT sign-off"] },
  { name: "UAT",                                      owner: "QA Manager",        approver: "Client",            prerequisites: ["UAT deployment"], iterate: "uat" },
  { name: "Test Sign-Off",                            owner: "QA Manager",        approver: "Client",            prerequisites: ["Test completion", "Client confirmation"] },
  { name: "Change Approval Board (CAB)",              owner: "Change Manager",    approver: "CAB",               prerequisites: ["SIT sign-off", "UAT sign-off", "Client approval", "Migration plan", "Downtime approval"] },
  { name: "Finalization",                             owner: "Solution Architect", approver: "Solution Architect", prerequisites: ["CAB approval"] },
  { name: "Production Migration",                     owner: "Deployment Lead",   approver: "Deployment Lead",   prerequisites: ["Approved migration plan"] },
  { name: "User Verification Test",                   owner: "Deployment Lead",   approver: "Client",            prerequisites: ["Production deployment"] },
  { name: "Code Synchronization (Primary to Secondary)", owner: "Deployment Lead", approver: "Deployment Lead",   prerequisites: ["Production stabilized"] },
  { name: "Project Closure Initiation",               owner: "Change Manager",    approver: "Client",            prerequisites: ["Client sign-off"] },
  { name: "Project Closed",                           owner: "Change Manager",    approver: "Change Manager",    prerequisites: ["Formal closure approval"] }
];

// PDOM BAU — 6 phases — from sheet "BAU"
const BAU_TEMPLATE = [
  { name: "Create Project",                           owner: "Project Manager",   approver: "Project Manager",   prerequisites: ["Access to Project Manager"] },
  { name: "Production Migration",                     owner: "Project Manager",   approver: "Project Manager",   prerequisites: [] },
  { name: "User Verification Test",                   owner: "Project Manager",   approver: "Client",            prerequisites: [] },
  { name: "Code Synch (PR to DR)",                    owner: "Project Manager",   approver: "Client",            prerequisites: [] },
  { name: "Project Closure",                          owner: "Change Manager",    approver: "Client",            prerequisites: ["Client sign-off"] },
  { name: "Project Closed",                           owner: "Change Manager",    approver: "Change Manager",    prerequisites: ["Change closed based on client sign-off"] }
];

const PHASE_TEMPLATES = {
  pdom18:      PDOM_PHASE_TEMPLATE,    // kept as alias for backward-compat; now 20 phases
  pdom_normal: PDOM_PHASE_TEMPLATE,
  unscheduled: UNSCHEDULED_TEMPLATE,
  bug_fix:     BUG_FIX_TEMPLATE,
  emergency:   EMERGENCY_TEMPLATE,
  bau:         BAU_TEMPLATE
};

function slugify(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || ("project-" + Date.now());
}

app.post("/api/projects", requireAuth, (req, res) => {
  const { name, client, pm, tech_lead, ba, qa_lead, sa, start_date, go_live_date, notes, include_pdom_phases, phase_template, dev_sprints, uat_rounds } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Project name required" });
  let slug = slugify(name);
  let suffix = 1;
  while (db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug)) { slug = slugify(name) + "-" + (++suffix); }
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects").get().m;

  // Decide which phase template to seed
  let template = null;
  if (phase_template === "lifecycle15") template = LIFECYCLE_15_TEMPLATE;
  else if (phase_template === "none") template = null;
  else if (phase_template && PHASE_TEMPLATES[phase_template]) template = PHASE_TEMPLATES[phase_template];
  else if (include_pdom_phases !== false) template = PDOM_PHASE_TEMPLATE; // backward-compat default

  // Agile: how many development sprints and UAT rounds to scaffold (default 1)
  const nSprints = Math.max(1, Math.min(20, +dev_sprints || 1));
  const nUat     = Math.max(1, Math.min(10, +uat_rounds  || 1));

  // Expand iterable phases (Development × nSprints, UAT × nUat)
  function expandTemplate(tpl) {
    if (!tpl) return [];
    const out = [];
    tpl.forEach(ph => {
      if (ph.iterate === "sprint" && nSprints > 1) {
        for (let s = 1; s <= nSprints; s++) out.push({ ...ph, name: `${ph.name} — Sprint ${s}` });
      } else if (ph.iterate === "uat" && nUat > 1) {
        for (let u = 1; u <= nUat; u++) out.push({ ...ph, name: `${ph.name} — Round ${u}` });
      } else { out.push(ph); }
    });
    return out;
  }
  const finalPhases = expandTemplate(template);

  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO projects
      (slug,name,client,pm,tech_lead,ba,qa_lead,sa,start_date,go_live_date,notes,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slug, name.trim(), client || null, pm || null, tech_lead || null, ba || null, qa_lead || null, sa || null, start_date || null, go_live_date || null, notes || null, maxOrder + 1);
    const projId = r.lastInsertRowid;
    if (finalPhases.length) {
      const insPh = db.prepare("INSERT INTO project_phases (project_id,phase_num,name,owner,approver,status) VALUES (?,?,?,?,?,?)");
      const insPre = db.prepare("INSERT INTO phase_prerequisites (phase_id,text,done,sort_order) VALUES (?,?,0,?)");
      finalPhases.forEach((ph, i) => {
        const status = i === 0 ? "in_progress" : "locked";
        const phId = insPh.run(projId, i + 1, ph.name, ph.owner, ph.approver, status).lastInsertRowid;
        (ph.prerequisites || []).forEach((t, pi) => insPre.run(phId, t, pi));
      });
    }
    // Seed the standard governance checklist on every new project
    const insGov = db.prepare("INSERT INTO project_governance (project_id,title,sort_order) VALUES (?,?,?)");
    STANDARD_GOVERNANCE.forEach((t, i) => insGov.run(projId, t, i));
    return projId;
  });
  const projId = tx();
  audit(req.user, "create", "project", projId, `Created project "${name}"`);
  res.json({ id: projId, slug });
});

app.delete("/api/projects/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const p = db.prepare("SELECT name FROM projects WHERE id = ?").get(id);
  if (!p) return res.status(404).json({ error: "Project not found" });
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  audit(req.user, "delete", "project", id, `Deleted project "${p.name}"`);
  res.json({ ok: true });
});

// ---------- PHASE CRUD ----------
app.post("/api/projects/:id/phases", requireAuth, (req, res) => {
  const projId = +req.params.id;
  const { name, owner, approver, prerequisites } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Phase name required" });
  const maxNum = db.prepare("SELECT COALESCE(MAX(phase_num), 0) AS m FROM project_phases WHERE project_id = ?").get(projId).m;
  const tx = db.transaction(() => {
    const r = db.prepare("INSERT INTO project_phases (project_id,phase_num,name,owner,approver,status) VALUES (?,?,?,?,?,?)")
      .run(projId, maxNum + 1, name.trim(), owner || null, approver || null, "locked");
    const phId = r.lastInsertRowid;
    if (Array.isArray(prerequisites)) {
      const insPre = db.prepare("INSERT INTO phase_prerequisites (phase_id,text,done,sort_order) VALUES (?,?,0,?)");
      prerequisites.forEach((t, i) => { if (t && String(t).trim()) insPre.run(phId, String(t).trim(), i); });
    }
    return phId;
  });
  const phId = tx();
  audit(req.user, "create", "project_phase", phId, `Added phase "${name}" to project #${projId}`);
  res.json({ id: phId });
});

app.patch("/api/phases/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const ph = db.prepare("SELECT * FROM project_phases WHERE id = ?").get(id);
  if (!ph) return res.status(404).json({ error: "Phase not found" });
  const fields = ["name", "owner", "approver", "notes", "status", "approver_user_id"];
  const updates = [], values = [];
  fields.forEach(f => { if (req.body && f in req.body) { updates.push(`${f} = ?`); values.push(req.body[f] === "" ? null : req.body[f]); } });
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE project_phases SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  audit(req.user, "update", "project_phase", id, `Updated phase #${id}`, req.body);
  res.json({ ok: true });
});

app.delete("/api/phases/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const ph = db.prepare("SELECT project_id, phase_num, name FROM project_phases WHERE id = ?").get(id);
  if (!ph) return res.status(404).json({ error: "Phase not found" });
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM project_phases WHERE id = ?").run(id);
    // Renumber remaining phases so phase_num stays contiguous
    const rest = db.prepare("SELECT id FROM project_phases WHERE project_id = ? ORDER BY phase_num").all(ph.project_id);
    const upd = db.prepare("UPDATE project_phases SET phase_num = ? WHERE id = ?");
    rest.forEach((row, i) => upd.run(i + 1, row.id));
  });
  tx();
  audit(req.user, "delete", "project_phase", id, `Deleted phase "${ph.name}" from project #${ph.project_id}`);
  res.json({ ok: true });
});

// ---------- PREREQUISITE CRUD ----------
app.post("/api/phases/:id/prerequisites", requireAuth, (req, res) => {
  const phaseId = +req.params.id;
  const { text } = req.body || {};
  const ph = db.prepare("SELECT id FROM project_phases WHERE id = ?").get(phaseId);
  if (!ph) return res.status(404).json({ error: "Phase not found" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM phase_prerequisites WHERE phase_id = ?").get(phaseId).m;
  const r = db.prepare("INSERT INTO phase_prerequisites (phase_id,text,done,sort_order) VALUES (?,?,0,?)")
    .run(phaseId, (text || "New prerequisite").trim(), maxOrder + 1);
  audit(req.user, "create", "phase_prerequisite", r.lastInsertRowid, `Added prerequisite to phase #${phaseId}`);
  res.json({ id: r.lastInsertRowid });
});

app.patch("/api/prerequisites/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const { text } = req.body || {};
  if (text == null) return res.json({ ok: true });
  db.prepare("UPDATE phase_prerequisites SET text = ? WHERE id = ?").run(String(text).trim(), id);
  res.json({ ok: true });
});

app.delete("/api/prerequisites/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  db.prepare("DELETE FROM phase_prerequisites WHERE id = ?").run(id);
  audit(req.user, "delete", "phase_prerequisite", id, `Deleted prerequisite #${id}`);
  res.json({ ok: true });
});

// ---------- GOVERNANCE CRUD ----------
app.post("/api/projects/:id/governance", requireAuth, (req, res) => {
  const projId = +req.params.id;
  const { title } = req.body || {};
  const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(projId);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM project_governance WHERE project_id = ?").get(projId).m;
  const r = db.prepare("INSERT INTO project_governance (project_id,title,sort_order) VALUES (?,?,?)")
    .run(projId, (title || "New governance item").trim(), maxOrder + 1);
  audit(req.user, "create", "project_governance", r.lastInsertRowid, `Added governance item to project #${projId}`);
  res.json({ id: r.lastInsertRowid });
});

app.patch("/api/governance/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const fields = ["title", "status", "owner", "due_date", "link", "notes"];
  const updates = [], values = [];
  fields.forEach(f => { if (req.body && f in req.body) { updates.push(`${f} = ?`); values.push(req.body[f] === "" ? null : req.body[f]); } });
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE project_governance SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  audit(req.user, "update", "project_governance", id, `Updated governance item #${id}`, req.body);
  res.json({ ok: true });
});

app.delete("/api/governance/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  db.prepare("DELETE FROM project_governance WHERE id = ?").run(id);
  audit(req.user, "delete", "project_governance", id, `Deleted governance item #${id}`);
  res.json({ ok: true });
});

// ---------- PROJECT PLAN (flexible editable grid) ----------
function getPlan(projId) {
  const proj = db.prepare("SELECT plan_columns FROM projects WHERE id = ?").get(projId);
  const columns = proj && proj.plan_columns ? JSON.parse(proj.plan_columns) : [];
  const rows = db.prepare("SELECT id, sort_order, cells FROM project_plan_rows WHERE project_id = ? ORDER BY sort_order, id").all(projId)
    .map(r => ({ id: r.id, sort_order: r.sort_order, cells: safeJson(r.cells) }));
  return { columns, rows };
}
function safeJson(s) { try { return JSON.parse(s || "{}"); } catch (e) { return {}; } }

app.get("/api/projects/:id/plan", requireAuth, (req, res) => {
  const projId = +req.params.id;
  const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(projId);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  res.json(getPlan(projId));
});

// Replace the column definitions (array of {key,label})
app.put("/api/projects/:id/plan-columns", requireAuth, (req, res) => {
  const projId = +req.params.id;
  const { columns } = req.body || {};
  if (!Array.isArray(columns)) return res.status(400).json({ error: "columns array required" });
  const clean = columns.filter(c => c && c.key).map(c => ({ key: String(c.key), label: String(c.label || c.key) }));
  db.prepare("UPDATE projects SET plan_columns = ? WHERE id = ?").run(JSON.stringify(clean), projId);
  audit(req.user, "update", "project_plan_columns", projId, `Updated plan columns for project #${projId}`);
  res.json({ ok: true });
});

app.post("/api/projects/:id/plan-rows", requireAuth, (req, res) => {
  const projId = +req.params.id;
  const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(projId);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const cells = req.body && req.body.cells && typeof req.body.cells === "object" ? req.body.cells : {};
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM project_plan_rows WHERE project_id = ?").get(projId).m;
  const r = db.prepare("INSERT INTO project_plan_rows (project_id, sort_order, cells) VALUES (?,?,?)")
    .run(projId, maxOrder + 1, JSON.stringify(cells));
  res.json({ id: r.lastInsertRowid });
});

app.patch("/api/plan-rows/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const row = db.prepare("SELECT cells FROM project_plan_rows WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Row not found" });
  if (req.body && req.body.cells && typeof req.body.cells === "object") {
    const merged = { ...safeJson(row.cells), ...req.body.cells };
    db.prepare("UPDATE project_plan_rows SET cells = ? WHERE id = ?").run(JSON.stringify(merged), id);
  }
  if (req.body && "sort_order" in req.body) {
    db.prepare("UPDATE project_plan_rows SET sort_order = ? WHERE id = ?").run(+req.body.sort_order, id);
  }
  res.json({ ok: true });
});

app.delete("/api/plan-rows/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM project_plan_rows WHERE id = ?").run(+req.params.id);
  res.json({ ok: true });
});

// Import an .xlsx — first sheet, row 1 = headers. Replaces the existing plan.
app.post("/api/projects/:id/plan-import", requireAuth, express.raw({ type: "*/*", limit: "25mb" }), (req, res) => {
  const projId = +req.params.id;
  const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(projId);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  if (!req.body || !req.body.length) return res.status(400).json({ error: "No file received" });
  let wb;
  try { wb = XLSX.read(req.body, { type: "buffer" }); }
  catch (e) { return res.status(400).json({ error: "Could not read file as Excel: " + e.message }); }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return res.status(400).json({ error: "Workbook has no sheets" });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });
  if (!aoa.length) return res.status(400).json({ error: "Sheet is empty" });
  const headerRow = aoa[0];
  const columns = headerRow.map((h, i) => ({ key: "c" + (i + 1), label: String(h || "").trim() || ("Column " + (i + 1)) }));

  const tx = db.transaction(() => {
    db.prepare("UPDATE projects SET plan_columns = ? WHERE id = ?").run(JSON.stringify(columns), projId);
    db.prepare("DELETE FROM project_plan_rows WHERE project_id = ?").run(projId);
    const ins = db.prepare("INSERT INTO project_plan_rows (project_id, sort_order, cells) VALUES (?,?,?)");
    let order = 0;
    for (let r = 1; r < aoa.length; r++) {
      const rowArr = aoa[r];
      // skip fully-empty rows
      if (!rowArr || rowArr.every(v => String(v ?? "").trim() === "")) continue;
      const cells = {};
      columns.forEach((c, i) => { cells[c.key] = String(rowArr[i] ?? ""); });
      ins.run(projId, order++, JSON.stringify(cells));
    }
    return order;
  });
  const count = tx();
  audit(req.user, "import", "project_plan", projId, `Imported plan from "${sheetName}" — ${columns.length} cols, ${count} rows`);
  res.json({ ok: true, columns: columns.length, rows: count, sheet: sheetName });
});

// Export the plan as .xlsx
app.get("/api/projects/:id/plan.xlsx", requireAuth, (req, res) => {
  const projId = +req.params.id;
  const proj = db.prepare("SELECT name, plan_columns FROM projects WHERE id = ?").get(projId);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const columns = proj.plan_columns ? JSON.parse(proj.plan_columns) : [];
  const rows = db.prepare("SELECT cells FROM project_plan_rows WHERE project_id = ? ORDER BY sort_order, id").all(projId);
  const aoa = [columns.map(c => c.label)];
  rows.forEach(r => { const cells = safeJson(r.cells); aoa.push(columns.map(c => cells[c.key] ?? "")); });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Project Plan");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const safeName = (proj.name || "project").replace(/[^a-z0-9]+/gi, "_");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}_plan.xlsx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

// ---------- DOCUMENT TEMPLATES (global library of URLs) ----------
app.get("/api/templates", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM document_templates ORDER BY sort_order, id").all());
});
app.post("/api/templates", requireAuth, (req, res) => {
  const { title, url, description, icon } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title required" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM document_templates").get().m;
  const r = db.prepare("INSERT INTO document_templates (title,url,description,icon,sort_order) VALUES (?,?,?,?,?)")
    .run(title.trim(), url || null, description || null, icon || "📄", maxOrder + 1);
  audit(req.user, "create", "document_template", r.lastInsertRowid, `Added template "${title}"`);
  res.json({ id: r.lastInsertRowid });
});
app.patch("/api/templates/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const fields = ["title", "url", "description", "icon"];
  const updates = [], values = [];
  fields.forEach(f => { if (req.body && f in req.body) { updates.push(`${f} = ?`); values.push(req.body[f] === "" ? null : req.body[f]); } });
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE document_templates SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  audit(req.user, "update", "document_template", id, `Updated template #${id}`, req.body);
  res.json({ ok: true });
});
app.delete("/api/templates/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM document_templates WHERE id = ?").run(+req.params.id);
  audit(req.user, "delete", "document_template", +req.params.id, `Deleted template #${req.params.id}`);
  res.json({ ok: true });
});

// ---------- MATURITY MATRIX ----------
app.get("/api/maturity", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM maturity_areas ORDER BY sort_order, id").all());
});
app.post("/api/maturity", requireAuth, (req, res) => {
  const { name, current_level, target_level, notes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Name required" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM maturity_areas").get().m;
  const r = db.prepare("INSERT INTO maturity_areas (name,current_level,target_level,notes,sort_order) VALUES (?,?,?,?,?)")
    .run(name.trim(), +current_level || 1, +target_level || 3, notes || null, maxOrder + 1);
  audit(req.user, "create", "maturity_area", r.lastInsertRowid, `Added maturity area "${name}"`);
  res.json({ id: r.lastInsertRowid });
});
app.patch("/api/maturity/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const fields = ["name", "current_level", "target_level", "notes"];
  const updates = [], values = [];
  fields.forEach(f => { if (req.body && f in req.body) { updates.push(`${f} = ?`); values.push(req.body[f] === "" ? null : req.body[f]); } });
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE maturity_areas SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  audit(req.user, "update", "maturity_area", id, `Updated maturity area #${id}`, req.body);
  res.json({ ok: true });
});
app.delete("/api/maturity/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM maturity_areas WHERE id = ?").run(+req.params.id);
  audit(req.user, "delete", "maturity_area", +req.params.id, `Deleted maturity area #${req.params.id}`);
  res.json({ ok: true });
});

// ---------- PARTNERSHIP PRINCIPLES ----------
app.get("/api/principles", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM principles ORDER BY sort_order, id").all());
});
app.post("/api/principles", requireAuth, (req, res) => {
  const { title, body, num } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Title required" });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM principles").get().m;
  const r = db.prepare("INSERT INTO principles (num,title,body,sort_order) VALUES (?,?,?,?)")
    .run(num != null ? +num : maxOrder + 2, title.trim(), body || null, maxOrder + 1);
  audit(req.user, "create", "principle", r.lastInsertRowid, `Added principle "${title}"`);
  res.json({ id: r.lastInsertRowid });
});
app.patch("/api/principles/:id", requireAuth, (req, res) => {
  const id = +req.params.id;
  const fields = ["num", "title", "body"];
  const updates = [], values = [];
  fields.forEach(f => { if (req.body && f in req.body) { updates.push(`${f} = ?`); values.push(req.body[f] === "" ? null : req.body[f]); } });
  if (!updates.length) return res.json({ ok: true });
  values.push(id);
  db.prepare(`UPDATE principles SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  audit(req.user, "update", "principle", id, `Updated principle #${id}`, req.body);
  res.json({ ok: true });
});
app.delete("/api/principles/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM principles WHERE id = ?").run(+req.params.id);
  audit(req.user, "delete", "principle", +req.params.id, `Deleted principle #${req.params.id}`);
  res.json({ ok: true });
});

// ---------- AUDIT LOG ----------
app.get("/api/audit", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT id,user_email,action,entity_type,entity_id,summary,created_at FROM audit_log ORDER BY created_at DESC LIMIT 100").all();
  res.json(rows);
});

// ---------- BACKUP API ----------
app.post("/api/admin/backup", requireAuth, async (req, res) => {
  const result = await backupNow(`manual-by-${req.user.email}`);
  if (!result.ok) return res.status(500).json(result);
  res.json(result);
});
app.get("/api/admin/backups", requireAuth, (req, res) => {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith(".db") || f.endsWith(".db.backup"))
      .map(f => {
        const s = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: s.size, mtime: s.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- root ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ---------- shutdown hook: backup before exit ----------
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] Shutting down — running final backup…`);
  try { await backupNow("on-shutdown"); } catch (e) { console.error("shutdown backup failed:", e.message); }
  process.exit(0);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

app.listen(PORT, async () => {
  console.log(`✓ Server running at http://localhost:${PORT}`);
  console.log(`  Open this URL in your browser. Log in with the admin user you created during setup.`);
  // Backup on every startup
  try { await backupNow("on-startup"); } catch (e) { console.error("startup backup failed:", e.message); }
  // Schedule daily 11 PM
  scheduleDailyBackup();
});
