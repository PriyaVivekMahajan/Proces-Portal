// ============================================================
// Frontend app — fetches data from API, same UI as local HTML dashboard
// ============================================================

let processes = [];
let projects = [];
let users = [];
let sprints = [];
let maturity = [];
let principles = [];
let templates = [];
let currentUser = null;
let currentView = localStorage.getItem("pd_current_view") || "home";
let currentTaskEditing = null;
let expandedPhases = new Set();
let pollTimer = null;
let planCache = null; // { projectId, columns, rows } for the open Project Plan grid
let planForceGrid = false; // when true, show grid even if Excel URL is set (toggle per session)
let sprintFilters = { owner: "", status: "" }; // "" = all

function setSprintFilter(field, value) {
  sprintFilters[field] = value;
  renderTopbar();
  renderContent();
}
function clearSprintFilters() {
  sprintFilters = { owner: "", status: "" };
  renderTopbar();
  renderContent();
}
function uniqueTaskOwners() {
  const set = new Set();
  processes.forEach(p => (p.tasks || []).forEach(t => { if (t.owner && t.owner.trim()) set.add(t.owner.trim()); }));
  return [...set].sort((a, b) => a.localeCompare(b));
}
let collapsedSections = {};
let ganttMode = localStorage.getItem("pd_gantt_mode") || "projects";
// Initialise drill-down state for the view we land on
(function(){ const a = activeSection(); collapsedSections = { processes: a !== "processes", projects: a !== "projects", views: a !== "views" }; })();

function activeSection() {
  if (currentView === "processes-all" || currentView.startsWith("process:")) return "processes";
  if (currentView === "projects-all" || currentView.startsWith("project:") || currentView.startsWith("plan:")) return "projects";
  if (["sprints","gantt","maturity","principles","templates","users"].includes(currentView)) return "views";
  return null; // home or unknown — no section expanded
}

function setGanttMode(m) {
  ganttMode = m;
  localStorage.setItem("pd_gantt_mode", m);
  renderTopbar();
  renderContent();
}

function toggleSection(key) {
  collapsedSections[key] = !collapsedSections[key];
  applySectionCollapse();
}
function applySectionCollapse() {
  [["processes","nav-processes","chev-processes"],["projects","nav-projects","chev-projects"],["views","nav-views","chev-views"]].forEach(([k,navId,chevId]) => {
    const nav = document.getElementById(navId);
    const chev = document.getElementById(chevId);
    const header = chev ? chev.parentElement : null;
    const collapsed = !!collapsedSections[k];
    if (nav) nav.classList.toggle("collapsed", collapsed);
    if (header) header.classList.toggle("collapsed", collapsed);
    if (chev) chev.textContent = collapsed ? "▸" : "▾";
  });
}

// ---------- API helpers ----------
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  if (r.status === 401) { location.href = "/login.html"; throw new Error("unauthorized"); }
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return r.status === 204 ? null : r.json();
}

// ---------- bootstrap ----------
async function boot() {
  try {
    const me = await api("/api/auth/me");
    currentUser = me.user;
  } catch { return; }
  document.getElementById("user-name").textContent = currentUser.name;
  await refreshData();
  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display = "grid";
  // Auto-refresh every 30 seconds to pick up edits from other users
  pollTimer = setInterval(refreshData, 30000);
}

async function refreshData() {
  try {
    [processes, projects, users, sprints, maturity, principles, templates] = await Promise.all([
      api("/api/processes"), api("/api/projects"), api("/api/users"), api("/api/sprints"),
      api("/api/maturity"), api("/api/principles"), api("/api/templates")
    ]);
    if (!currentView || (currentView.startsWith("process:") && !findProcessBySlug(currentView.slice(8)))) {
      currentView = processes[0] ? "process:" + processes[0].slug : "projects-all";
    }
    renderAll();
    pulseSaved();
  } catch (e) { console.error("refresh failed:", e); }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/login.html";
}

async function backupNow() {
  const status = document.getElementById("backup-status");
  if (status) status.textContent = "Backing up…";
  try {
    const r = await api("/api/admin/backup", { method: "POST" });
    if (status) status.textContent = "✓ Saved: " + r.file;
    pulseSaved();
  } catch (e) {
    if (status) status.textContent = "⚠ " + e.message;
    alert("Backup failed: " + e.message);
  }
}

function pulseSaved() {
  const el = document.getElementById("saved-pulse");
  el.classList.add("show");
  clearTimeout(window._t);
  window._t = setTimeout(() => el.classList.remove("show"), 1000);
}

// ---------- helpers ----------
function esc(s) { return s == null ? "" : String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function findProcessBySlug(s) { return processes.find(p => p.slug === s); }
function findProjectBySlug(s) { return projects.find(p => p.slug === s); }
function findTaskById(id) { for (const p of processes) for (const t of p.tasks) if (t.id === id) return [p, t]; return [null, null]; }
function findPhaseById(id) { for (const pr of projects) for (const ph of pr.phases) if (ph.id === id) return [pr, ph]; return [null, null]; }
function projectProgress(p) { const t = p.phases.length, d = p.phases.filter(x => x.status === "completed").length; return { done: d, total: t, pct: t ? Math.round(d/t*100) : 0 }; }
function projectCurrentPhase(p) { return p.phases.find(x => x.status === "in_progress") || p.phases[p.phases.length-1]; }
function projectRAG(p) {
  const v = [p.rag_scope, p.rag_timeline, p.rag_budget, p.rag_resources, p.rag_quality];
  if (v.includes("red")) return "red"; if (v.includes("amber")) return "amber"; return "green";
}
function iconFor(slug) {
  const map = { "ai-initiative":"🤖", "qa-process":"🧪", "scrum-of-scrum":"👥", "pm-process":"📋", "videos":"🎬", "training-mentor":"📚" };
  return map[slug] || "📁";
}

function computeStats() {
  const today = new Date().toISOString().slice(0,10);
  let total=0,done=0,prog=0,over=0;
  processes.forEach(p => p.tasks.forEach(t => {
    total++; if (t.status === "completed") done++; else if (t.status === "in_progress") prog++;
    if (t.due_date && t.due_date < today && t.status !== "completed") over++;
  }));
  return { total, done, prog, over, pct: total ? Math.round(done/total*100) : 0 };
}

function switchView(view) {
  currentView = view;
  expandedPhases.clear();
  if (view.startsWith("plan:")) planCache = null;
  // Drill-down: collapse all sections except the one matching the new view
  const a = activeSection();
  collapsedSections = { processes: a !== "processes", projects: a !== "projects", views: a !== "views" };
  localStorage.setItem("pd_current_view", view);
  renderAll();
  const c = document.getElementById("content-area"); if (c) c.scrollTop = 0;
}

// ---------- sidebar ----------
function renderSidebar() {
  // Home item (always visible at the top, no section)
  const nh = document.getElementById("nav-home");
  if (nh) nh.innerHTML = `<div class="nav-item ${currentView==='home'?'active':''}" onclick="switchView('home')"><span class="nav-icon">🏠</span><span class="nav-label">Home</span></div>`;

  const np = document.getElementById("nav-processes");
  np.classList.add("nav-group");
  const procAll = `<div class="nav-item ${currentView==='processes-all'?'active':''}" onclick="switchView('processes-all')"><span class="nav-icon">🗂</span><span class="nav-label">All Processes</span><span class="nav-badge">${processes.length}</span></div>`;
  np.innerHTML = procAll + processes.map(p => {
    const pending = p.tasks.filter(t => t.status !== "completed").length;
    const active = currentView === "process:" + p.slug;
    return `<div class="nav-item ${active?'active':''}" onclick="switchView('process:${p.slug}')"><span class="nav-icon">${p.icon||iconFor(p.slug)}</span><span class="nav-label">${esc(p.title)}</span><span class="nav-badge">${pending}</span></div>`;
  }).join("");

  const projAll = `<div class="nav-item ${currentView==='projects-all'?'active':''}" onclick="switchView('projects-all')"><span class="nav-icon">📊</span><span class="nav-label">All Projects</span><span class="nav-badge">${projects.length}</span></div>`;
  const projs = projects.map(pr => {
    const a = currentView === "project:" + pr.slug;
    const prog = projectProgress(pr);
    return `<div class="nav-item ${a?'active':''}" onclick="switchView('project:${pr.slug}')"><span class="nav-icon">📁</span><span class="nav-label">${esc(pr.name)}</span><span class="nav-badge">${prog.pct}%</span></div>`;
  }).join("");
  const npp = document.getElementById("nav-projects");
  npp.classList.add("nav-group");
  npp.innerHTML = projAll + projs;

  const nv = document.getElementById("nav-views");
  nv.classList.add("nav-group");
  nv.innerHTML = `<div class="nav-item ${currentView==='sprints'?'active':''}" onclick="switchView('sprints')"><span class="nav-icon">🏃</span><span class="nav-label">Sprints</span><span class="nav-badge">${sprints.length}</span></div>` +
    `<div class="nav-item ${currentView==='gantt'?'active':''}" onclick="switchView('gantt')"><span class="nav-icon">📈</span><span class="nav-label">Gantt Chart</span></div>` +
    `<div class="nav-item ${currentView==='maturity'?'active':''}" onclick="switchView('maturity')"><span class="nav-icon">🎯</span><span class="nav-label">Maturity</span><span class="nav-badge">${maturity.length}</span></div>` +
    `<div class="nav-item ${currentView==='principles'?'active':''}" onclick="switchView('principles')"><span class="nav-icon">🤝</span><span class="nav-label">Principles</span><span class="nav-badge">${principles.length}</span></div>` +
    `<div class="nav-item ${currentView==='templates'?'active':''}" onclick="switchView('templates')"><span class="nav-icon">📄</span><span class="nav-label">Templates</span><span class="nav-badge">${templates.length}</span></div>` +
    `<div class="nav-item ${currentView==='users'?'active':''}" onclick="switchView('users')"><span class="nav-icon">👥</span><span class="nav-label">Team</span><span class="nav-badge">${users.length}</span></div>`;

  applySectionCollapse();
}

function renderTiles() {
  const tilesEl = document.getElementById("tiles");
  // Only show stats tiles on overview pages where they add value
  const showOn = ["processes-all","projects-all"];
  const isProcessView = currentView.startsWith("process:");
  if (!showOn.includes(currentView) && !isProcessView) {
    tilesEl.classList.add("tiles-hidden");
    return;
  }
  tilesEl.classList.remove("tiles-hidden");
  const s = computeStats();
  const projAvg = projects.length ? Math.round(projects.reduce((a,p)=>a+projectProgress(p).pct,0)/projects.length) : 0;
  const atRisk = projects.filter(p => projectRAG(p) !== "green").length;
  tilesEl.innerHTML = `
    <div class="tile"><div class="tile-label">Process tasks</div><div class="tile-row"><span class="tile-value">${s.total}</span><span class="tile-pct">${s.pct}%</span></div><div class="progress-mini"><div class="progress-mini-bar" style="width:${s.pct}%"></div></div></div>
    <div class="tile done"><div class="tile-label">✓ Done</div><div class="tile-value">${s.done}</div></div>
    <div class="tile prog"><div class="tile-label">⏳ Active</div><div class="tile-value">${s.prog}</div></div>
    <div class="tile"><div class="tile-label">📁 Projects (avg)</div><div class="tile-row"><span class="tile-value">${projects.length}</span><span class="tile-pct">${projAvg}%</span></div><div class="progress-mini"><div class="progress-mini-bar" style="width:${projAvg}%"></div></div></div>
    <div class="tile over"><div class="tile-label">⚠ At risk</div><div class="tile-value">${atRisk}</div></div>
  `;
}

function renderTopbar() {
  const right = document.getElementById("topbar-right");
  if (currentView === "home") {
    document.getElementById("topbar-icon").textContent = "🏠";
    document.getElementById("topbar-title").textContent = "Dashboard";
    document.getElementById("topbar-meta").textContent = `Welcome, ${currentUser?currentUser.name:''}`;
    document.getElementById("banner-area").style.display = "none";
    right.innerHTML = `<span style="font-size:11px;color:#6b7280;">Live sync · 30s</span>`;
  } else if (currentView === "processes-all") {
    document.getElementById("topbar-icon").textContent = "🗂";
    document.getElementById("topbar-title").textContent = "All Processes";
    document.getElementById("topbar-meta").textContent = `${processes.length} processes`;
    document.getElementById("banner-area").style.display = "block";
    document.getElementById("process-desc").textContent = "Every team-wide process tracked in one place. Click a card to open its task board, or create a new process to start tracking one.";
    right.innerHTML = `<span style="font-size:11px;color:#6b7280;margin-right:8px;">Live sync · ${currentUser.name}</span><button class="btn btn-primary" onclick="openNewProcessModal()">+ New Process</button>`;
  } else if (currentView.startsWith("process:")) {
    const p = findProcessBySlug(currentView.slice(8)); if (!p) return;
    document.getElementById("topbar-icon").textContent = p.icon || iconFor(p.slug);
    document.getElementById("topbar-title").textContent = p.title + " · " + (p.subtitle || "");
    document.getElementById("topbar-meta").textContent = p.meta || "";
    document.getElementById("banner-area").style.display = "block";
    document.getElementById("process-desc").textContent = p.description || "";
    right.innerHTML = `<input type="text" class="search" id="search" placeholder="🔍 Search..."><select class="filter-sel" id="filter-status"><option value="all">All</option><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="blocked">Blocked</option></select><button class="btn" onclick="openNewSprintModal()">+ Sprint</button><button class="btn btn-primary" onclick="addTask(${p.id})">+ Task</button><button class="btn" style="color:#dc2626;" onclick="deleteProcess(${p.id})" title="Delete process">🗑</button>`;
    document.getElementById("search").addEventListener("input", renderContent);
    document.getElementById("filter-status").addEventListener("change", renderContent);
  } else if (currentView === "projects-all") {
    document.getElementById("topbar-icon").textContent = "📊";
    document.getElementById("topbar-title").textContent = "All Projects · Adani BU";
    document.getElementById("topbar-meta").textContent = `${projects.length} projects · 18-phase stage-gated workflow`;
    document.getElementById("banner-area").style.display = "block";
    document.getElementById("process-desc").textContent = "Each project follows the 18-phase PDOM. Phases unlock sequentially — only after prerequisites are met and the approver signs off. Click any project to view its plan.";
    right.innerHTML = `<span style="font-size:11px;color:#6b7280;margin-right:8px;">Live sync · ${currentUser.name}</span><button class="btn btn-primary" onclick="openNewProjectModal()">+ New Project</button>`;
  } else if (currentView === "sprints") {
    document.getElementById("topbar-icon").textContent = "🏃";
    document.getElementById("topbar-title").textContent = "Sprints";
    document.getElementById("topbar-meta").textContent = `${sprints.length} shared sprint(s) · across all processes`;
    document.getElementById("banner-area").style.display = "block";
    document.getElementById("process-desc").textContent = "Sprints are shared across every process. Any process task can be assigned to any sprint. Each sprint below shows its tasks grouped by the process they belong to.";
    const owners = uniqueTaskOwners();
    const ownerOpts = `<option value="">All users</option>` + owners.map(o => `<option value="${esc(o)}" ${sprintFilters.owner===o?'selected':''}>${esc(o)}</option>`).join("");
    const statusBtn = (val, label) => `<button class="btn ${sprintFilters.status===val?'btn-primary':''}" onclick="setSprintFilter('status','${val}')">${label}</button>`;
    const clearBtn = (sprintFilters.owner || sprintFilters.status) ? `<button class="btn" onclick="clearSprintFilters()" title="Clear all filters">✕</button>` : "";
    right.innerHTML = `<select class="filter-sel" onchange="setSprintFilter('owner', this.value)" title="Filter by owner">${ownerOpts}</select>
      ${statusBtn('', 'All')}
      ${statusBtn('in_progress', '⏳ In Progress')}
      ${statusBtn('completed', '✓ Completed')}
      ${clearBtn}
      <button class="btn btn-primary" onclick="openNewSprintModal()">+ Sprint</button>`;
  } else if (currentView === "maturity") {
    document.getElementById("topbar-icon").textContent = "🎯";
    document.getElementById("topbar-title").textContent = "Delivery Process Maturity";
    document.getElementById("topbar-meta").textContent = "Current state vs FY27 target";
    document.getElementById("banner-area").style.display = "block";
    document.getElementById("process-desc").textContent = "1 Ad hoc · 2 Repeatable · 3 Defined · 4 Managed · 5 Optimizing.  Edit the Current and Target columns inline. Add new areas anytime.";
    right.innerHTML = `<button class="btn btn-primary" onclick="addMaturityArea()">+ Area</button>`;
  } else if (currentView === "principles") {
    document.getElementById("topbar-icon").textContent = "🤝";
    document.getElementById("topbar-title").textContent = "Partnership Principles";
    document.getElementById("topbar-meta").textContent = "How we work with clients";
    document.getElementById("banner-area").style.display = "block";
    document.getElementById("process-desc").textContent = "The core principles that guide every engagement. Edit any card inline or add a new principle.";
    right.innerHTML = `<button class="btn btn-primary" onclick="addPrinciple()">+ Principle</button>`;
  } else if (currentView === "templates") {
    document.getElementById("topbar-icon").textContent = "📄";
    document.getElementById("topbar-title").textContent = "Document Templates";
    document.getElementById("topbar-meta").textContent = `${templates.length} template(s) · shared across all projects`;
    document.getElementById("banner-area").style.display = "block";
    document.getElementById("process-desc").textContent = "Paste OneDrive / SharePoint / Drive URLs for each document template. They appear as quick links on every project's detail page — clicking opens in a new tab.";
    right.innerHTML = `<button class="btn btn-primary" onclick="addTemplate()">+ Template</button>`;
  } else if (currentView === "users") {
    const isAdmin = currentUser && currentUser.role === "admin";
    document.getElementById("topbar-icon").textContent = "👥";
    document.getElementById("topbar-title").textContent = "Team";
    document.getElementById("topbar-meta").textContent = `${users.length} user(s)`;
    document.getElementById("banner-area").style.display = "block";
    document.getElementById("process-desc").textContent = isAdmin
      ? "Everyone with an account on this dashboard. As an admin you can add new members, change roles, or remove accounts."
      : "Everyone with an account on this dashboard. Only admins can add, remove, or change roles.";
    right.innerHTML = isAdmin
      ? `<button class="btn btn-primary" onclick="openNewUserModal()">+ Add user</button>`
      : `<span style="font-size:11px;color:#6b7280;">Read-only · admins manage the team</span>`;
  } else if (currentView === "gantt") {
    document.getElementById("topbar-icon").textContent = "📈";
    document.getElementById("topbar-title").textContent = "Gantt Chart";
    document.getElementById("banner-area").style.display = "block";
    if (ganttMode === "processes") {
      document.getElementById("topbar-meta").textContent = `${processes.length} processes · task timeline`;
      document.getElementById("process-desc").textContent = "Timeline of process tasks grouped by process. Each bar runs from when the task was created to its due date, colored by status. The red line marks today; overdue open tasks are outlined in red.";
    } else {
      document.getElementById("topbar-meta").textContent = `${projects.length} projects · timeline view`;
      document.getElementById("process-desc").textContent = "Visual timeline of all projects. Bars span Start Date → Go-Live Date; filled portion reflects phase completion. The red line marks today.";
    }
    const tog = (m, label) => `<button class="btn ${ganttMode===m?'btn-primary':''}" onclick="setGanttMode('${m}')">${label}</button>`;
    right.innerHTML = `<div style="display:flex;gap:4px;">${tog('projects','📁 Projects')}${tog('processes','🗂 Processes')}</div>`;
  } else if (currentView.startsWith("project:")) {
    const pr = findProjectBySlug(currentView.slice(8)); if (!pr) return;
    document.getElementById("topbar-icon").textContent = "📁";
    document.getElementById("topbar-title").textContent = pr.name + " — Project Plan";
    document.getElementById("topbar-meta").textContent = "Client: " + (pr.client||"") + " · PM: " + (pr.pm||"");
    document.getElementById("banner-area").style.display = "none";
    right.innerHTML = `<button class="btn" onclick="switchView('projects-all')">← All projects</button><button class="btn btn-primary" onclick="switchView('plan:${pr.slug}')">📊 Project Plan</button><button class="btn" style="color:#dc2626;" onclick="deleteProject(${pr.id})">🗑 Delete project</button>`;
  } else if (currentView.startsWith("plan:")) {
    const pr = findProjectBySlug(currentView.slice(5)); if (!pr) return;
    document.getElementById("topbar-icon").textContent = "📊";
    document.getElementById("topbar-title").textContent = pr.name + " — Project Plan";
    document.getElementById("topbar-meta").textContent = "Live spreadsheet · edits save instantly";
    document.getElementById("banner-area").style.display = "none";
    right.innerHTML = `<button class="btn" onclick="switchView('project:${pr.slug}')">← Back to project</button>`;
  }
}

function renderContent() {
  const ca = document.getElementById("content-area");
  if (currentView === "home") renderHomeView(ca);
  else if (currentView === "processes-all") renderProcessesList(ca);
  else if (currentView.startsWith("process:")) renderProcessTasks(ca, findProcessBySlug(currentView.slice(8)));
  else if (currentView === "projects-all") renderProjectsList(ca);
  else if (currentView === "sprints") renderSprintsView(ca);
  else if (currentView === "maturity") renderMaturityView(ca);
  else if (currentView === "principles") renderPrinciplesView(ca);
  else if (currentView === "templates") renderTemplatesView(ca);
  else if (currentView === "users") renderTeamView(ca);
  else if (currentView === "gantt") renderGantt(ca);
  else if (currentView.startsWith("plan:")) renderPlan(ca, findProjectBySlug(currentView.slice(5)));
  else if (currentView.startsWith("project:")) renderProjectDetail(ca, findProjectBySlug(currentView.slice(8)));
}

// ---------- Gantt ----------
function renderGantt(ca) {
  if (ganttMode === "processes") return renderGanttProcesses(ca);
  return renderGanttProjects(ca);
}

function renderGanttProjects(ca) {
  const rows = projects.filter(p => p.start_date || p.go_live_date);
  if (!rows.length) {
    ca.innerHTML = `<div class="gantt-wrap"><div class="gantt-empty">No projects have Start Date / Go-Live Date set yet. Open a project and fill those fields to see it on the timeline.</div></div>`;
    return;
  }
  const parse = d => d ? new Date(d + "T00:00:00") : null;
  let minD = null, maxD = null;
  rows.forEach(p => {
    const s = parse(p.start_date), g = parse(p.go_live_date);
    [s, g].forEach(d => { if (d) { if (!minD || d < minD) minD = d; if (!maxD || d > maxD) maxD = d; } });
  });
  const today = new Date(); today.setHours(0,0,0,0);
  if (!minD || today < minD) minD = new Date(today.getTime() - 14*86400000);
  if (!maxD || today > maxD) maxD = new Date(today.getTime() + 30*86400000);
  // pad 5% each side
  const span = maxD - minD;
  const pad = span * 0.04;
  minD = new Date(minD.getTime() - pad);
  maxD = new Date(maxD.getTime() + pad);
  const totalMs = maxD - minD;
  const pos = d => ((d - minD) / totalMs) * 100;

  // build month ticks
  const ticks = [];
  let t = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (t <= maxD) {
    if (t >= minD) ticks.push(new Date(t));
    t = new Date(t.getFullYear(), t.getMonth() + 1, 1);
  }
  const tickHtml = ticks.map(d => {
    const left = pos(d);
    const label = d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    return `<div class="gantt-axis-tick" style="left:${left}%;">${label}</div>`;
  }).join("");

  const todayLeft = pos(today);
  const todayMarker = (todayLeft >= 0 && todayLeft <= 100)
    ? `<div class="gantt-today" style="left:${todayLeft}%;"><div class="gantt-today-label">TODAY</div></div>`
    : "";

  const rowHtml = rows.map(p => {
    const s = parse(p.start_date) || parse(p.go_live_date);
    const g = parse(p.go_live_date) || parse(p.start_date);
    const left = pos(s);
    const width = Math.max(0.5, pos(g) - pos(s));
    const prog = projectProgress(p);
    const rag = projectRAG(p);
    const cur = projectCurrentPhase(p);
    const dateRange = `${p.start_date || '?'} → ${p.go_live_date || '?'}`;
    return `<div class="gantt-row-label" onclick="switchView('project:${p.slug}')"><div class="rag-dot ${rag}"></div><div><div>${esc(p.name)}</div><div class="row-meta">${esc(cur ? cur.name : 'All complete')} · ${dateRange}</div></div></div>
      <div class="gantt-bar-track">
        <div class="gantt-bar" style="left:${left}%; width:${width}%;">
          <div class="gantt-bar-fill" style="width:${prog.pct}%;"></div>
          <div class="gantt-bar-label">${prog.pct}% · ${prog.done}/${prog.total}</div>
        </div>
      </div>`;
  }).join("");

  ca.innerHTML = `<div class="gantt-wrap"><div class="gantt-grid">
    <div class="gantt-head-label">Project</div>
    <div class="gantt-axis">${tickHtml}${todayMarker}</div>
    ${rowHtml}
  </div></div>`;
}

function renderGanttProcesses(ca) {
  const STATUS_COLOR = { completed: "#10b981", in_progress: "#6366f1", blocked: "#ef4444", not_started: "#9ca3af" };
  const STATUS_LABEL = { completed: "Completed", in_progress: "In progress", blocked: "Blocked", not_started: "Not started" };
  const parse = d => d ? new Date(String(d).slice(0,10) + "T00:00:00") : null;

  // Collect all dated points across every task
  const allTasks = [];
  processes.forEach(p => (p.tasks || []).forEach(t => allTasks.push({ proc: p, task: t })));
  const dated = allTasks.filter(x => x.task.due_date || x.task.created_at);
  if (!dated.length) {
    ca.innerHTML = `<div class="gantt-wrap"><div class="gantt-empty">No process tasks have dates yet. Add a due date to tasks to see them on the timeline.</div></div>`;
    return;
  }

  let minD = null, maxD = null;
  dated.forEach(({ task }) => {
    [parse(task.created_at), parse(task.due_date)].forEach(d => { if (d) { if (!minD || d < minD) minD = d; if (!maxD || d > maxD) maxD = d; } });
  });
  const today = new Date(); today.setHours(0,0,0,0);
  if (!minD || today < minD) minD = new Date(today.getTime() - 14*86400000);
  if (!maxD || today > maxD) maxD = new Date(today.getTime() + 30*86400000);
  const pad = (maxD - minD) * 0.04 || 7*86400000;
  minD = new Date(minD.getTime() - pad);
  maxD = new Date(maxD.getTime() + pad);
  const totalMs = maxD - minD;
  const pos = d => ((d - minD) / totalMs) * 100;

  const ticks = [];
  let t = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (t <= maxD) { if (t >= minD) ticks.push(new Date(t)); t = new Date(t.getFullYear(), t.getMonth() + 1, 1); }
  const tickHtml = ticks.map(d => `<div class="gantt-axis-tick" style="left:${pos(d)}%;">${d.toLocaleDateString(undefined,{month:"short",year:"2-digit"})}</div>`).join("");
  const todayLeft = pos(today);
  const todayMarker = (todayLeft >= 0 && todayLeft <= 100) ? `<div class="gantt-today" style="left:${todayLeft}%;"><div class="gantt-today-label">TODAY</div></div>` : "";
  const todayStr = today.toISOString().slice(0,10);

  let body = "";
  processes.forEach(p => {
    const tasks = p.tasks || [];
    if (!tasks.length) return;
    const done = tasks.filter(t => t.status === "completed").length;
    body += `<div style="grid-column:1/-1;background:#f9fafb;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:8px 12px;font-size:12px;font-weight:700;color:#111827;display:flex;justify-content:space-between;align-items:center;">
      <span>${p.icon || iconFor(p.slug)} ${esc(p.title)}</span>
      <span style="font-size:11px;color:#6b7280;font-weight:600;">${done}/${tasks.length} done</span>
    </div>`;
    tasks.forEach(tk => {
      const created = parse(tk.created_at);
      const due = parse(tk.due_date);
      const color = STATUS_COLOR[tk.status] || "#9ca3af";
      const overdue = tk.due_date && tk.due_date < todayStr && tk.status !== "completed";
      let bar;
      if (due) {
        const s = (created && created < due) ? created : new Date(due.getTime() - 5*86400000);
        const left = pos(s);
        const width = Math.max(1.5, pos(due) - left);
        bar = `<div class="gantt-bar" style="left:${left}%;width:${width}%;background:${color};${overdue?'outline:2px solid #ef4444;outline-offset:1px;':''}"><div class="gantt-bar-label">${esc(tk.due_date)}</div></div>`;
      } else if (created) {
        bar = `<div class="gantt-bar" style="left:${pos(created)}%;width:1.2%;background:${color};opacity:0.5;"></div>`;
      } else { bar = ""; }
      body += `<div class="gantt-row-label" onclick="switchView('process:${p.slug}')" title="${esc(tk.title)}">
        <div class="rag-dot" style="background:${color};"></div>
        <div><div style="font-weight:500;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${esc(tk.title)}</div><div class="row-meta">${STATUS_LABEL[tk.status]||tk.status}${tk.owner?' · '+esc(tk.owner):''}${tk.due_date?'':' · no due date'}</div></div>
      </div>
      <div class="gantt-bar-track">${bar}</div>`;
    });
  });

  ca.innerHTML = `<div class="gantt-wrap"><div class="gantt-grid">
    <div class="gantt-head-label">Task</div>
    <div class="gantt-axis">${tickHtml}${todayMarker}</div>
    ${body}
  </div></div>`;
}

function taskMatchesFilter(t) {
  const fs = document.getElementById("filter-status"); const sb = document.getElementById("search");
  const fStatus = fs ? fs.value : "all"; const search = sb ? sb.value.toLowerCase().trim() : "";
  if (fStatus !== "all" && t.status !== fStatus) return false;
  if (search && !(t.title + " " + (t.notes||"") + " " + (t.owner||"")).toLowerCase().includes(search)) return false;
  return true;
}

function renderTaskCard(p, t) {
  const sub = t.subitems || []; const subD = sub.filter(s=>s.done).length; const subP = sub.length?Math.round(subD/sub.length*100):0;
  const today = new Date().toISOString().slice(0,10);
  const over = t.due_date && t.due_date < today && t.status !== "completed";
  const lbl = { not_started:"Not Started", in_progress:"In Progress", completed:"Completed", blocked:"Blocked" }[t.status] || "Not Started";
  let moveCtrl = "";
  if (sprints.length) {
    const opts = `<option value="">📥 Backlog</option>` +
      sprints.map(s => `<option value="${s.id}" ${t.sprint_id===s.id?'selected':''}>${esc(s.name)}</option>`).join("");
    moveCtrl = `<div class="task-sprint-move" onclick="event.stopPropagation()"><span class="ico">🏃</span><select onchange="moveTaskToSprint(${t.id}, this.value)" title="Move to sprint">${opts}</select></div>`;
  }
  return `<div class="task-card status-${t.status}" onclick="openModal(${t.id})">${over?'<span class="task-overdue-flag">⚠ OVERDUE</span>':''}<div class="task-card-top"><input type="checkbox" class="task-check" ${t.status==='completed'?'checked':''} onclick="event.stopPropagation(); toggleComplete(${t.id})"><div class="task-card-title">${esc(t.title)}</div></div><div class="task-card-meta"><span class="status-pill ${t.status}">${lbl}</span>${t.owner?`<span class="task-meta-item"><span class="ico">👤</span>${esc(t.owner)}</span>`:''}${t.due_date?`<span class="task-meta-item"><span class="ico">📅</span>${esc(t.due_date)}</span>`:''}${sub.length?`<span class="task-meta-item"><span class="ico">☑</span>${subD}/${sub.length}</span>`:''}</div>${sub.length?`<div class="task-progress"><div class="task-progress-bar"><div class="task-progress-fill" style="width:${subP}%"></div></div></div>`:''}${moveCtrl}</div>`;
}

async function moveTaskToSprint(taskId, sprintId) {
  try { await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ sprint_id: sprintId || null }) }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

function sprintProgress(p, sprintId) {
  const tasks = p.tasks.filter(t => sprintId === null ? !t.sprint_id : t.sprint_id === sprintId);
  const total = tasks.length, done = tasks.filter(t => t.status === "completed").length;
  return { total, done, pct: total ? Math.round(done/total*100) : 0 };
}

function renderProcessTasks(ca, p) {
  if (!p) { ca.innerHTML = '<div class="empty">Not found</div>'; return; }
  const grid = (tasks, addSprintId) => `<div class="tasks-grid">${tasks.map(t=>renderTaskCard(p,t)).join("")}<div class="add-card" onclick="addTask(${p.id}, ${addSprintId===null?'null':addSprintId})">+ Add task</div></div>`;

  if (!sprints.length) {
    const vis = p.tasks.filter(taskMatchesFilter);
    const hint = `<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">No sprints yet — tasks are unassigned. Use <b>+ Sprint</b> (top right) to create a shared sprint, then add tasks to it.</div>`;
    ca.innerHTML = hint + grid(vis, null);
    return;
  }

  let html = "";
  // Only show sprint groups that contain at least one task of this process
  sprints.forEach(s => {
    const tasks = p.tasks.filter(t => t.sprint_id === s.id);
    if (!tasks.length) return;
    const vis = tasks.filter(taskMatchesFilter);
    html += renderSprintHeaderLight(p, s) + grid(vis, s.id);
  });
  const backlog = p.tasks.filter(t => !t.sprint_id && taskMatchesFilter(t));
  html += `<div class="sprint-head backlog"><span class="sprint-name" style="cursor:default;">📥 Backlog (unassigned)</span><span class="sprint-prog">${backlog.length} task(s)</span><span class="sprint-actions"><button class="btn" onclick="addTask(${p.id}, null)">+ Task</button></span></div>` + grid(backlog, null);
  ca.innerHTML = html;
}

// Light sprint header for inside a process view (per-process progress); full editing lives in the global Sprints view
function renderSprintHeaderLight(p, s) {
  const prog = sprintProgress(p, s.id);
  const dates = (s.start_date || s.end_date) ? `${s.start_date||'?'} → ${s.end_date||'?'}` : '';
  return `<div class="sprint-head status-${s.status}">
    <span class="sprint-name" style="cursor:pointer;" onclick="switchView('sprints')" title="Manage in Sprints view">🏃 ${esc(s.name)}</span>
    ${dates?`<span class="sprint-meta">${dates}</span>`:''}
    <span class="status-pill ${s.status==='active'?'in_progress':s.status==='completed'?'completed':'not_started'}">${s.status}</span>
    <span class="sprint-prog">${prog.done}/${prog.total} · ${prog.pct}%<span class="sprint-prog-track"><span class="sprint-prog-fill" style="width:${prog.pct}%"></span></span></span>
    <span class="sprint-actions"><button class="btn" onclick="addTask(${p.id}, ${s.id})">+ Task</button></span>
  </div>`;
}

function renderProjectCard(pr) {
  const prog = projectProgress(pr); const cur = projectCurrentPhase(pr); const rag = projectRAG(pr);
  const lbl = rag==="green"?"🟢 ON TRACK":rag==="amber"?"🟡 WATCH":"🔴 AT RISK";
  return `<div class="project-card" onclick="switchView('project:${pr.slug}')"><div class="proj-card-top"><div><div class="proj-name">${esc(pr.name)}</div><div class="proj-client">${esc(pr.client||'')}</div></div><span class="rag ${rag}">${lbl}</span></div><div class="proj-stats"><div><div class="proj-stat-label">PM</div><div class="proj-stat-value">${esc(pr.pm||'—')}</div></div><div><div class="proj-stat-label">Tech Lead</div><div class="proj-stat-value">${esc(pr.tech_lead||'—')}</div></div><div><div class="proj-stat-label">Start</div><div class="proj-stat-value">${esc(pr.start_date||'—')}</div></div><div><div class="proj-stat-label">Go-Live</div><div class="proj-stat-value">${esc(pr.go_live_date||'—')}</div></div></div><div class="proj-phase-bar"><div class="proj-phase-bar-label"><span>Phase progress</span><span><b>${prog.done}/${prog.total}</b> · ${prog.pct}%</span></div><div class="proj-phase-bar-track"><div class="proj-phase-bar-fill" style="width:${prog.pct}%"></div></div></div><div class="proj-current-phase"><div class="proj-current-phase-label">Current Phase</div><div class="proj-current-phase-name">${esc(cur?cur.name:'All complete')}</div></div></div>`;
}

function renderProjectsList(ca) {
  const addCard = `<div class="project-card" style="border:2px dashed #d1d5db;display:flex;align-items:center;justify-content:center;color:#6366f1;font-weight:500;min-height:160px;cursor:pointer;" onclick="openNewProjectModal()">+ New Project</div>`;
  ca.innerHTML = `<div class="projects-grid">${projects.map(renderProjectCard).join("")}${addCard}</div>`;
}

function renderProcessCard(p) {
  const total = p.tasks.length;
  const done = p.tasks.filter(t => t.status === "completed").length;
  const prog = p.tasks.filter(t => t.status === "in_progress").length;
  const pct = total ? Math.round(done/total*100) : 0;
  const today = new Date().toISOString().slice(0,10);
  const overdue = p.tasks.filter(t => t.due_date && t.due_date < today && t.status !== "completed").length;
  return `<div class="project-card" onclick="switchView('process:${p.slug}')">
    <div class="proj-card-top">
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <div style="font-size:28px;">${p.icon || iconFor(p.slug)}</div>
        <div><div class="proj-name">${esc(p.title)}</div><div class="proj-client">${esc(p.subtitle||'')}</div></div>
      </div>
      ${overdue?`<span class="rag red">⚠ ${overdue} overdue</span>`:''}
    </div>
    ${p.description?`<div style="font-size:12px;color:#4b5563;margin-top:10px;line-height:1.4;">${esc(p.description)}</div>`:''}
    ${p.meta?`<div style="font-size:11px;color:#6b7280;margin-top:8px;">${esc(p.meta)}</div>`:''}
    <div class="proj-stats">
      <div><div class="proj-stat-label">Total tasks</div><div class="proj-stat-value">${total}</div></div>
      <div><div class="proj-stat-label">In progress</div><div class="proj-stat-value">${prog}</div></div>
    </div>
    <div class="proj-phase-bar">
      <div class="proj-phase-bar-label"><span>Completion</span><span><b>${done}/${total}</b> · ${pct}%</span></div>
      <div class="proj-phase-bar-track"><div class="proj-phase-bar-fill" style="width:${pct}%"></div></div>
    </div>
  </div>`;
}

function renderProcessesList(ca) {
  const addCard = `<div class="project-card" style="border:2px dashed #d1d5db;display:flex;align-items:center;justify-content:center;color:#6366f1;font-weight:500;min-height:160px;cursor:pointer;" onclick="openNewProcessModal()">+ New Process</div>`;
  ca.innerHTML = `<div class="projects-grid">${processes.map(renderProcessCard).join("")}${addCard}</div>`;
}

function ragSw(projId, field, label, val) {
  const c = {green:"🟢",amber:"🟡",red:"🔴"};
  const opts = ["green","amber","red"].map(v => `<option value="${v}" ${v===val?'selected':''}>${c[v]} ${v}</option>`).join("");
  return `<label style="font-size:12px;display:inline-flex;align-items:center;gap:4px;">${label}<select class="filter-sel" style="font-size:11px;padding:2px 4px;" onchange="updateProj(${projId},'${field}',this.value)">${opts}</select></label>`;
}

function renderProjectDetail(ca, pr) {
  if (!pr) { ca.innerHTML = '<div class="empty">Not found</div>'; return; }
  const prog = projectProgress(pr);
  const hdr = `<div class="proj-detail-header"><div class="proj-detail-title-row"><div><input class="proj-detail-title" style="border:1px solid transparent;background:transparent;padding:1px 4px;border-radius:4px;font:inherit;font-size:22px;font-weight:700;color:#111827;width:100%;" value="${esc(pr.name)}" onchange="updateProj(${pr.id},'name',this.value)"><input style="font-size:12px;color:#6b7280;margin-top:2px;border:1px solid transparent;background:transparent;padding:1px 4px;border-radius:4px;font-family:inherit;width:100%;" value="${esc(pr.client||'')}" placeholder="Client" onchange="updateProj(${pr.id},'client',this.value)"></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">${ragSw(pr.id,'rag_scope',"Scope",pr.rag_scope)}${ragSw(pr.id,'rag_timeline',"Timeline",pr.rag_timeline)}${ragSw(pr.id,'rag_budget',"Budget",pr.rag_budget)}${ragSw(pr.id,'rag_resources',"Resources",pr.rag_resources)}${ragSw(pr.id,'rag_quality',"Quality",pr.rag_quality)}</div></div><div class="proj-detail-meta"><div><div class="proj-meta-label">Project Manager</div><div class="proj-meta-value"><input value="${esc(pr.pm||'')}" onchange="updateProj(${pr.id},'pm',this.value)"></div></div><div><div class="proj-meta-label">Tech Lead</div><div class="proj-meta-value"><input value="${esc(pr.tech_lead||'')}" onchange="updateProj(${pr.id},'tech_lead',this.value)"></div></div><div><div class="proj-meta-label">BA</div><div class="proj-meta-value"><input value="${esc(pr.ba||'')}" onchange="updateProj(${pr.id},'ba',this.value)"></div></div><div><div class="proj-meta-label">QA Lead</div><div class="proj-meta-value"><input value="${esc(pr.qa_lead||'')}" onchange="updateProj(${pr.id},'qa_lead',this.value)"></div></div><div><div class="proj-meta-label">Solution Architect</div><div class="proj-meta-value"><input value="${esc(pr.sa||'')}" onchange="updateProj(${pr.id},'sa',this.value)"></div></div><div><div class="proj-meta-label">Start Date</div><div class="proj-meta-value"><input type="date" value="${esc(pr.start_date||'')}" onchange="updateProj(${pr.id},'start_date',this.value)"></div></div><div><div class="proj-meta-label">Go-Live Date</div><div class="proj-meta-value"><input type="date" value="${esc(pr.go_live_date||'')}" onchange="updateProj(${pr.id},'go_live_date',this.value)"></div></div><div><div class="proj-meta-label">Progress</div><div class="proj-meta-value">${prog.done}/${prog.total} · ${prog.pct}%</div></div></div><div style="margin-top:12px;"><div class="proj-meta-label">Notes</div><textarea class="field-input textarea" style="margin-top:4px;" placeholder="Project notes" onchange="updateProj(${pr.id},'notes',this.value)">${esc(pr.notes||'')}</textarea></div></div>`;
  const phases = pr.phases.map((ph,i)=>renderPhaseCard(pr,ph,i)).join("");
  const timeline = `<div class="timeline"><div class="timeline-title"><span>📋 Project Plan (PDOM)</span><span class="timeline-subtitle">${pr.phases.length} phases · unlocks sequentially after approval</span></div>${phases}<div class="add-card" style="margin-top:10px;" onclick="openNewPhaseModal(${pr.id})">+ Add phase</div></div>`;
  ca.innerHTML = hdr + renderTemplateChips() + renderGovernance(pr) + timeline;
}

function renderGovernance(pr) {
  const items = pr.governance || [];
  const done = items.filter(g => g.status === "done").length;
  const counted = items.filter(g => g.status !== "na").length;
  const pct = counted ? Math.round(done / counted * 100) : 0;
  const statusSel = (g) => {
    const opts = [["not_started","Not started"],["in_progress","In progress"],["done","Done"],["na","N/A"]]
      .map(([v,l]) => `<option value="${v}" ${g.status===v?'selected':''}>${l}</option>`).join("");
    return `<select class="gov-status ${g.status}" onchange="updateGov(${g.id},'status',this.value)">${opts}</select>`;
  };
  const rows = items.map(g => `<tr>
    <td style="min-width:160px;"><input value="${esc(g.title)}" onchange="updateGov(${g.id},'title',this.value)"></td>
    <td style="width:120px;">${statusSel(g)}</td>
    <td style="width:120px;"><input value="${esc(g.owner||'')}" placeholder="—" onchange="updateGov(${g.id},'owner',this.value)"></td>
    <td style="width:130px;"><input type="date" value="${esc(g.due_date||'')}" onchange="updateGov(${g.id},'due_date',this.value)"></td>
    <td style="width:170px;"><input value="${esc(g.link||'')}" placeholder="https://… (Azure Boards, doc)" onchange="updateGov(${g.id},'link',this.value)">${g.link?` <a class="gov-link-a" href="${esc(g.link)}" target="_blank" rel="noopener" title="Open link">↗</a>`:''}</td>
    <td><input value="${esc(g.notes||'')}" placeholder="—" onchange="updateGov(${g.id},'notes',this.value)"></td>
    <td class="gov-del" onclick="deleteGov(${g.id})" title="Delete">×</td>
  </tr>`).join("");
  return `<div class="gov-card">
    <div class="gov-title"><span>🛡 Project Governance</span><span class="timeline-subtitle">${done}/${counted} complete · ${pct}%</span></div>
    <table class="gov-table">
      <thead><tr><th>Item</th><th>Status</th><th>Owner</th><th>Due</th><th>Link</th><th>Notes</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="color:#9ca3af;padding:10px;">No governance items.</td></tr>'}</tbody>
    </table>
    <span class="add-subitem-btn" onclick="addGov(${pr.id})">+ Add governance item</span>
  </div>`;
}

function userOptions(selectedId) {
  const sel = selectedId == null ? "" : String(selectedId);
  return `<option value="">— anyone may approve —</option>` +
    users.map(u => `<option value="${u.id}" ${String(u.id)===sel?'selected':''}>${esc(u.name)}${u.role==='admin'?' (admin)':''}</option>`).join("");
}

// ---------- Project Plan (editable grid) ----------
function findProjectById(id) { return projects.find(p => p.id === id); }

function renderPlan(ca, pr) {
  if (!pr) { ca.innerHTML = '<div class="empty">Not found</div>'; return; }
  // If already drawn for this project, don't clobber it on the 30s poll (preserves cell focus/typing)
  const existing = ca.querySelector(".plan-wrap");
  if (existing && existing.dataset.planProject === String(pr.id)) return;
  // If an Excel embed URL is set (and we're not in forced-grid mode), no need to fetch the in-app grid data
  if (pr.plan_excel_url && !planForceGrid) {
    drawPlanEmbed(ca, pr);
    return;
  }
  if (!planCache || planCache.projectId !== pr.id) {
    ca.innerHTML = '<div class="empty">Loading plan…</div>';
    loadPlan(pr.id);
    return;
  }
  drawPlan(ca, pr, planCache);
}

async function loadPlan(projId) {
  try {
    const data = await api(`/api/projects/${projId}/plan`);
    planCache = { projectId: projId, columns: data.columns || [], rows: data.rows || [] };
    if (currentView === "plan:" + (findProjectById(projId) || {}).slug) {
      drawPlan(document.getElementById("content-area"), findProjectById(projId), planCache);
    }
  } catch (e) {
    const ca = document.getElementById("content-area");
    if (ca) ca.innerHTML = `<div class="empty">Failed to load plan: ${esc(e.message)}</div>`;
  }
}

function drawPlan(ca, pr, plan) {
  // If a live Excel embed URL is set for this project, render the iframe instead of the grid
  if (pr.plan_excel_url && !planForceGrid) {
    drawPlanEmbed(ca, pr);
    return;
  }
  const cols = plan.columns || [];
  const rows = plan.rows || [];
  const switchBack = pr.plan_excel_url ? `<button class="btn" onclick="planForceGrid=false; drawPlan(document.getElementById('content-area'), findProjectById(${pr.id}), planCache);">📊 Back to embedded Excel</button>` : "";
  const connectBtn = pr.plan_excel_url
    ? `<button class="btn" onclick="planSetExcelUrl(${pr.id})" title="Edit OneDrive Excel link">🔗 Excel link</button>`
    : `<button class="btn btn-primary" onclick="planSetExcelUrl(${pr.id})" title="Embed a live OneDrive / SharePoint Excel here">🔗 Connect Excel</button>`;
  const toolbar = `<div class="plan-toolbar">
    ${connectBtn}
    <button class="btn" onclick="planPickImport(${pr.id})">⬆ Import Excel</button>
    <button class="btn" onclick="window.location='/api/projects/${pr.id}/plan.xlsx'">⬇ Export Excel</button>
    ${switchBack}
    <span style="flex:1;"></span>
    <button class="btn" onclick="planAddColumn(${pr.id})">+ Column</button>
    <button class="btn" onclick="planAddRow(${pr.id})">+ Row</button>
    <button class="btn" onclick="loadPlan(${pr.id})" title="Reload from server">↻</button>
    <input type="file" id="plan-file" accept=".xlsx,.xls,.csv" style="display:none" onchange="planImport(${pr.id}, this.files[0]); this.value='';">
  </div>`;

  if (!cols.length) {
    ca.innerHTML = `<div class="plan-wrap" data-plan-project="${pr.id}">${toolbar}
      <div class="gantt-empty">No plan yet for <b>${esc(pr.name)}</b>.<br><br>
        <button class="btn btn-primary" onclick="planPickImport(${pr.id})">⬆ Import your Excel</button>
        &nbsp;or&nbsp;
        <button class="btn" onclick="planStartBlank(${pr.id})">Start a blank table</button>
      </div></div>`;
    return;
  }

  const headCells = cols.map(c =>
    `<th><div class="plan-col"><input value="${esc(c.label)}" onchange="planRenameColumn(${pr.id},'${c.key}',this.value)" title="Rename column"><span class="plan-col-del" onclick="planDelColumn(${pr.id},'${c.key}')" title="Delete column">×</span></div></th>`
  ).join("");

  const bodyRows = rows.map(r => {
    const tds = cols.map(c =>
      `<td><input value="${esc(r.cells[c.key] || '')}" onchange="savePlanCell(${r.id},'${c.key}',this.value)"></td>`
    ).join("");
    return `<tr>${tds}<td class="plan-row-del" onclick="planDelRow(${r.id},${pr.id})" title="Delete row">×</td></tr>`;
  }).join("");

  ca.innerHTML = `<div class="plan-wrap" data-plan-project="${pr.id}">${toolbar}
    <div class="plan-scroll"><table class="plan-table">
      <thead><tr>${headCells}<th style="width:30px;"></th></tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${cols.length+1}" style="color:#9ca3af;padding:12px;">No rows yet. Click <b>+ Row</b>.</td></tr>`}</tbody>
    </table></div>
    <div style="font-size:11px;color:#9ca3af;margin-top:8px;">${rows.length} row(s) · ${cols.length} column(s) · edits save automatically</div>
  </div>`;
}

function drawPlanEmbed(ca, pr) {
  const url = pr.plan_excel_url;
  const toolbar = `<div class="plan-toolbar">
    <button class="btn" onclick="planSetExcelUrl(${pr.id})" title="Change the embedded Excel link">🔗 Edit link</button>
    <button class="btn" onclick="window.open('${esc(url)}','_blank')" title="Open in a new tab">↗ Open in OneDrive</button>
    <button class="btn" onclick="planForceGrid=true; drawPlan(document.getElementById('content-area'), findProjectById(${pr.id}), planCache||{columns:[],rows:[]});" title="Show the in-app grid instead">🗂 Grid view</button>
    <button class="btn" onclick="planClearExcelUrl(${pr.id})" style="color:#dc2626;" title="Disconnect Excel">✕ Disconnect</button>
    <span style="flex:1;"></span>
    <button class="btn" onclick="planReloadIframe()" title="Reload embedded Excel">↻</button>
  </div>`;
  ca.innerHTML = `<div class="plan-wrap" data-plan-project="${pr.id}">${toolbar}
    <iframe id="plan-iframe" class="plan-iframe" src="${esc(url)}" allow="clipboard-read; clipboard-write" referrerpolicy="origin"></iframe>
    <div style="font-size:11px;color:#9ca3af;margin-top:8px;">Live OneDrive / SharePoint Excel. Each viewer needs Microsoft sign-in (the iframe will prompt if needed) and read or edit permission on the file.</div>
  </div>`;
}
function planReloadIframe() { const f = document.getElementById("plan-iframe"); if (f) f.src = f.src; }

async function planSetExcelUrl(projId) {
  const proj = findProjectById(projId); if (!proj) return;
  const current = proj.plan_excel_url || "";
  const help = "Paste the OneDrive / SharePoint embed URL.\n\nTo get one:\n  • Open the file in OneDrive\n  • File → Share → Embed\n  • Copy the URL from the iframe code (the part inside src=\"…\")\n\nA plain share link may be blocked from embedding — use the Embed option.";
  const url = prompt(help, current);
  if (url === null) return;
  const trimmed = url.trim();
  try {
    await api(`/api/projects/${projId}`, { method: "PATCH", body: JSON.stringify({ plan_excel_url: trimmed || null }) });
    planForceGrid = false;
    await refreshData();
  } catch (e) { alert("Failed: " + e.message); }
}
async function planClearExcelUrl(projId) {
  if (!confirm("Disconnect the embedded Excel from this project?\n\nThe in-app grid stays intact; you can reconnect anytime.")) return;
  try {
    await api(`/api/projects/${projId}`, { method: "PATCH", body: JSON.stringify({ plan_excel_url: null }) });
    planForceGrid = false;
    await refreshData();
  } catch (e) { alert("Failed: " + e.message); }
}

async function savePlanCell(rowId, colKey, value) {
  try {
    await api(`/api/plan-rows/${rowId}`, { method: "PATCH", body: JSON.stringify({ cells: { [colKey]: value } }) });
    const row = planCache && planCache.rows.find(r => r.id === rowId);
    if (row) row.cells[colKey] = value;
    pulseSaved();
  } catch (e) { alert("Save failed: " + e.message); }
}
async function planAddRow(projId) {
  try {
    const r = await api(`/api/projects/${projId}/plan-rows`, { method: "POST", body: JSON.stringify({ cells: {} }) });
    planCache.rows.push({ id: r.id, sort_order: planCache.rows.length, cells: {} });
    drawPlan(document.getElementById("content-area"), findProjectById(projId), planCache);
  } catch (e) { alert("Failed: " + e.message); }
}
async function planDelRow(rowId, projId) {
  if (!confirm("Delete this row?")) return;
  try {
    await api(`/api/plan-rows/${rowId}`, { method: "DELETE" });
    planCache.rows = planCache.rows.filter(r => r.id !== rowId);
    drawPlan(document.getElementById("content-area"), findProjectById(projId), planCache);
  } catch (e) { alert("Failed: " + e.message); }
}
async function planAddColumn(projId) {
  const label = prompt("Column name:", "");
  if (label === null) return;
  const cols = [...planCache.columns, { key: "c" + Date.now(), label: label.trim() || ("Column " + (planCache.columns.length + 1)) }];
  try {
    await api(`/api/projects/${projId}/plan-columns`, { method: "PUT", body: JSON.stringify({ columns: cols }) });
    planCache.columns = cols;
    drawPlan(document.getElementById("content-area"), findProjectById(projId), planCache);
  } catch (e) { alert("Failed: " + e.message); }
}
async function planRenameColumn(projId, key, label) {
  const cols = planCache.columns.map(c => c.key === key ? { ...c, label } : c);
  try { await api(`/api/projects/${projId}/plan-columns`, { method: "PUT", body: JSON.stringify({ columns: cols }) }); planCache.columns = cols; pulseSaved(); }
  catch (e) { alert("Save failed: " + e.message); }
}
async function planDelColumn(projId, key) {
  if (!confirm("Delete this column? Existing data in it will be hidden.")) return;
  const cols = planCache.columns.filter(c => c.key !== key);
  try {
    await api(`/api/projects/${projId}/plan-columns`, { method: "PUT", body: JSON.stringify({ columns: cols }) });
    planCache.columns = cols;
    drawPlan(document.getElementById("content-area"), findProjectById(projId), planCache);
  } catch (e) { alert("Failed: " + e.message); }
}
async function planStartBlank(projId) {
  const cols = [
    { key: "c1", label: "Task / Activity" }, { key: "c2", label: "Owner" }, { key: "c3", label: "Start" },
    { key: "c4", label: "End" }, { key: "c5", label: "Status" }, { key: "c6", label: "% Complete" }, { key: "c7", label: "Notes" }
  ];
  try {
    await api(`/api/projects/${projId}/plan-columns`, { method: "PUT", body: JSON.stringify({ columns: cols }) });
    planCache = { projectId: projId, columns: cols, rows: [] };
    drawPlan(document.getElementById("content-area"), findProjectById(projId), planCache);
  } catch (e) { alert("Failed: " + e.message); }
}
function planPickImport(projId) { document.getElementById("plan-file").click(); }
async function planImport(projId, file) {
  if (!file) return;
  if (!confirm(`Import "${file.name}"?\n\nThis REPLACES the current plan grid with the spreadsheet's first sheet (row 1 = column headers).`)) return;
  try {
    const buf = await file.arrayBuffer();
    const r = await fetch(`/api/projects/${projId}/plan-import`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/octet-stream" }, body: buf });
    if (!r.ok) { const e = await r.json().catch(() => ({ error: "Import failed" })); throw new Error(e.error); }
    const res = await r.json();
    alert(`Imported ${res.rows} row(s) and ${res.columns} column(s) from sheet "${res.sheet}".`);
    await loadPlan(projId);
  } catch (e) { alert("Import failed: " + e.message); }
}

function renderPhaseCard(pr, ph, idx) {
  const key = pr.id + "_" + ph.id; const exp = expandedPhases.has(key);
  const prDone = ph.prerequisites.every(p=>p.done);
  const assignedUser = ph.approver_user_id ? users.find(u => u.id === ph.approver_user_id) : null;
  const isAssignedApprover = !ph.approver_user_id || (currentUser && currentUser.id === ph.approver_user_id);
  const can = ph.status === "in_progress" && prDone && isAssignedApprover;
  const cl = ph.status === "completed" ? "✓" : (idx+1);
  const lbl = ph.status === "completed" ? "Completed" : ph.status === "in_progress" ? "In Progress" : "Locked";
  const editable = ph.status !== "completed";
  const prereqRows = ph.prerequisites.map(r=>`<div class="prereq-item ${r.done?'done':''}"><input type="checkbox" ${r.done?'checked':''} ${ph.status!=='in_progress'?'disabled':''} onchange="togglePrereq(${ph.id},${r.id},this.checked)"><span contenteditable="${editable?'true':'false'}" onblur="updatePrereqText(${r.id}, this.textContent)">${esc(r.text)}</span>${editable?`<span class="subitem-del" title="Delete" onclick="deletePrereq(${r.id})">×</span>`:''}</div>`).join("");
  const addPrereqBtn = editable ? `<span class="add-subitem-btn" onclick="addPrereq(${ph.id})">+ Add prerequisite</span>` : '';
  const editHeader = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;">
    <input class="field-input" style="flex:1;min-width:140px;" value="${esc(ph.name)}" onchange="updatePhase(${ph.id},'name',this.value)" placeholder="Phase name">
    <input class="field-input" style="flex:1;min-width:120px;" value="${esc(ph.owner||'')}" onchange="updatePhase(${ph.id},'owner',this.value)" placeholder="Owner">
    <input class="field-input" style="flex:1;min-width:120px;" value="${esc(ph.approver||'')}" onchange="updatePhase(${ph.id},'approver',this.value)" placeholder="Approver (label)">
    <select class="filter-sel" onchange="updatePhase(${ph.id},'status',this.value)">
      <option value="locked" ${ph.status==='locked'?'selected':''}>Locked</option>
      <option value="in_progress" ${ph.status==='in_progress'?'selected':''}>In progress</option>
      <option value="completed" ${ph.status==='completed'?'selected':''}>Completed</option>
    </select>
    <button class="btn" style="color:#dc2626;" onclick="deletePhase(${ph.id})" title="Delete phase">🗑</button>
  </div>
  <div style="display:flex;gap:6px;align-items:center;margin-top:6px;">
    <span class="phase-section-label" style="margin:0;">Approver account</span>
    <select class="filter-sel" style="flex:1;min-width:160px;" onchange="updatePhase(${ph.id},'approver_user_id',this.value)" title="Only this user account may click Approve">
      ${userOptions(ph.approver_user_id)}
    </select>
  </div>`;
  let approveInfo;
  if (!prDone) approveInfo = `<span style="color:#dc2626;">⚠ Complete prerequisites first</span>`;
  else if (assignedUser && !isAssignedApprover) approveInfo = `<span style="color:#dc2626;">🔒 Only <b>${esc(assignedUser.name)}</b> can approve</span>`;
  else if (assignedUser) approveInfo = `Ready — you are the assigned approver (<b>${esc(assignedUser.name)}</b>)`;
  else approveInfo = `Ready for approval${ph.approver?` by <b>${esc(ph.approver)}</b>`:''}`;
  return `<div class="phase-row"><div><div class="phase-circle ${ph.status}">${cl}</div></div><div class="phase-card ${ph.status}"><div class="phase-head" onclick="togglePhase('${key}')"><div><div class="phase-name">${idx+1}. ${esc(ph.name)}</div><div class="phase-owner-line">Owner: <b>${esc(ph.owner||'')}</b> · Approver: <b>${esc(ph.approver||'')}</b>${assignedUser?` · 👤 <b>${esc(assignedUser.name)}</b>`:''} · <span class="status-pill ${ph.status}">${lbl}</span></div></div><span>${exp?'▾':'▸'}</span></div><div class="phase-body ${exp?'expanded':''}">${editHeader}<div class="phase-section-label" style="margin-top:14px;">Prerequisites</div>${prereqRows||'<div style="font-size:12px;color:#9ca3af;padding:4px 0;">None yet</div>'}${addPrereqBtn}${ph.status==="in_progress"?`<div class="phase-actions"><div class="phase-approve-info">${approveInfo}</div><button class="btn btn-success" ${can?'':'disabled style="opacity:0.4;cursor:not-allowed;"'} onclick="approvePhase(${ph.id})">✓ Approve & Unlock Next</button></div>`:ph.status==='completed'?`<div style="font-size:11px;color:#059669;font-weight:600;margin-top:6px;">✓ Approved</div>`:`<div class="lock-banner" style="margin-top:8px;">🔒 Locked — set to In progress to start working on this phase</div>`}</div></div></div>`;
}

function togglePhase(key) { if (expandedPhases.has(key)) expandedPhases.delete(key); else expandedPhases.add(key); renderContent(); }

async function togglePrereq(phaseId, prereqId, done) {
  try { await api(`/api/phases/${phaseId}/prerequisites/${prereqId}`, { method: "PATCH", body: JSON.stringify({ done }) }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

async function approvePhase(phaseId) {
  const [pr, ph] = findPhaseById(phaseId); if (!ph) return;
  if (!confirm(`Approve "${ph.name}"?\n\nApprover: ${ph.approver}`)) return;
  try { await api(`/api/phases/${phaseId}/approve`, { method: "POST" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

async function updateProj(id, field, value) {
  try { await api(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); pulseSaved(); }
  catch (e) { alert("Save failed: " + e.message); }
}

async function toggleComplete(taskId) {
  const [, t] = findTaskById(taskId); if (!t) return;
  const newStatus = t.status === "completed" ? "in_progress" : "completed";
  try { await api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

async function addTask(processId, sprintId = null) {
  try {
    const r = await api(`/api/processes/${processId}/tasks`, { method: "POST", body: JSON.stringify({ title: "New task", sprint_id: sprintId }) });
    await refreshData();
    openModal(r.id);
  } catch (e) { alert("Failed: " + e.message); }
}

// ---------- Sprint CRUD ----------
function openNewSprintModal() {
  document.getElementById("sprint-modal-name").value = "";
  document.getElementById("sprint-modal-start").value = "";
  document.getElementById("sprint-modal-end").value = "";
  document.getElementById("sprint-modal-status").value = "planned";
  document.getElementById("sprint-modal-goal").value = "";
  document.getElementById("sprint-modal-bg").classList.add("show");
  setTimeout(()=>document.getElementById("sprint-modal-name").focus(), 50);
}
function closeSprintModal() { document.getElementById("sprint-modal-bg").classList.remove("show"); }
async function submitNewSprint() {
  const name = document.getElementById("sprint-modal-name").value.trim();
  if (!name) { alert("Sprint name is required"); return; }
  try {
    await api(`/api/sprints`, { method: "POST", body: JSON.stringify({
      name,
      start_date: document.getElementById("sprint-modal-start").value || null,
      end_date: document.getElementById("sprint-modal-end").value || null,
      status: document.getElementById("sprint-modal-status").value,
      goal: document.getElementById("sprint-modal-goal").value.trim() || null
    })});
    closeSprintModal();
    await refreshData();
  } catch (e) { alert("Failed: " + e.message); }
}
async function updateSprint(id, field, value) {
  try { await api(`/api/sprints/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); await refreshData(); }
  catch (e) { alert("Save failed: " + e.message); }
}
async function deleteSprint(id) {
  if (!confirm("Delete this sprint? Its tasks move to the Backlog (they are not deleted).")) return;
  try { await api(`/api/sprints/${id}`, { method: "DELETE" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

// ---------- Home (dashboard overview) ----------
function renderHomeView(ca) {
  const s = computeStats();
  const projAvg = projects.length ? Math.round(projects.reduce((a,p)=>a+projectProgress(p).pct,0)/projects.length) : 0;
  const atRisk = projects.filter(p => projectRAG(p) !== "green").length;
  const activeSprint = sprints.find(x => x.status === "active");
  const matAvgCur = maturity.length ? (maturity.reduce((a,m)=>a+m.current_level,0)/maturity.length).toFixed(1) : "—";
  const matAvgTgt = maturity.length ? (maturity.reduce((a,m)=>a+m.target_level,0)/maturity.length).toFixed(1) : "—";

  const card = (icon, title, body, view, accent) =>
    `<div class="home-card" onclick="switchView('${view}')" style="border-left-color:${accent};">
      <div class="home-card-head"><span class="home-icon">${icon}</span><span class="home-title">${title}</span></div>
      <div class="home-body">${body}</div>
    </div>`;

  ca.innerHTML = `<div class="home-grid">
    ${card("🗂", "Processes",
      `<div class="home-big">${processes.length}</div>
       <div class="home-sub">${s.total} tasks · ${s.done} done (${s.pct}%) · ${s.prog} in progress</div>`,
      "processes-all", "#6366f1")}

    ${card("📁", "Projects",
      `<div class="home-big">${projects.length}</div>
       <div class="home-sub">${projAvg}% avg phase progress · ${atRisk?`<span style="color:#dc2626;">${atRisk} at risk</span>`:'all on track'}</div>`,
      "projects-all", "#0ea5e9")}

    ${card("🏃", "Sprints",
      `<div class="home-big">${sprints.length}</div>
       <div class="home-sub">${activeSprint?`Active: <b>${esc(activeSprint.name)}</b>`:'No active sprint'}</div>`,
      "sprints", "#f59e0b")}

    ${card("📈", "Gantt",
      `<div class="home-big" style="font-size:13px;color:#6b7280;font-weight:500;line-height:1.4;">Timeline view of all projects and process tasks.</div>`,
      "gantt", "#10b981")}

    ${card("🎯", "Maturity",
      `<div class="home-big">${matAvgCur} <span style="font-size:14px;color:#9ca3af;">→ ${matAvgTgt}</span></div>
       <div class="home-sub">Avg level across ${maturity.length} areas (1 Ad hoc · 5 Optimizing)</div>`,
      "maturity", "#a855f7")}

    ${card("🤝", "Principles",
      `<div class="home-big">${principles.length}</div>
       <div class="home-sub">Partnership principles guiding every engagement</div>`,
      "principles", "#ec4899")}
  </div>`;
}

// ---------- Maturity Matrix ----------
const MATURITY_LEVELS = [
  { v: 1, label: "Ad hoc",     color: "#fee2e2", fg: "#991b1b" },
  { v: 2, label: "Repeatable", color: "#fed7aa", fg: "#9a3412" },
  { v: 3, label: "Defined",    color: "#dbeafe", fg: "#1e40af" },
  { v: 4, label: "Managed",    color: "#d1fae5", fg: "#065f46" },
  { v: 5, label: "Optimizing", color: "#e9d5ff", fg: "#6b21a8" }
];
function levelPill(v) {
  const lv = MATURITY_LEVELS.find(l => l.v === +v) || MATURITY_LEVELS[0];
  return `<span class="mat-pill" style="background:${lv.color};color:${lv.fg};">${lv.v} ${lv.label}</span>`;
}
function levelSelect(id, field, v) {
  const opts = MATURITY_LEVELS.map(l => `<option value="${l.v}" ${l.v===+v?'selected':''}>${l.v} ${l.label}</option>`).join("");
  return `<select class="mat-sel" onchange="updateMaturity(${id},'${field}',+this.value)">${opts}</select>`;
}

function renderMaturityView(ca) {
  if (!maturity.length) {
    ca.innerHTML = `<div class="mat-card"><div class="gantt-empty">No maturity areas yet. Click <b>+ Area</b>.</div></div>`;
    return;
  }
  const rows = maturity.map(m => `<tr>
    <td><input value="${esc(m.name)}" onchange="updateMaturity(${m.id},'name',this.value)"></td>
    <td>${levelSelect(m.id,'current_level',m.current_level)}</td>
    <td><input value="${esc(m.notes||'')}" placeholder="—" onchange="updateMaturity(${m.id},'notes',this.value)"></td>
    <td>${levelSelect(m.id,'target_level',m.target_level)}</td>
    <td class="gov-del" onclick="deleteMaturity(${m.id})" title="Delete">×</td>
  </tr>`).join("");

  // Simple bar visualisation: each area gets a row with current (filled solid) and target (lighter, dashed)
  const maxL = 5;
  const chart = maturity.map(m => {
    const cPct = (m.current_level / maxL) * 100;
    const tPct = (m.target_level / maxL) * 100;
    return `<div class="mat-chart-row">
      <div class="mat-chart-label">${esc(m.name)}</div>
      <div class="mat-chart-bar">
        <div class="mat-chart-target" style="width:${tPct}%;"></div>
        <div class="mat-chart-current" style="width:${cPct}%;"></div>
        <div class="mat-chart-axis">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div class="mat-chart-vals">${m.current_level} → ${m.target_level}</div>
    </div>`;
  }).join("");

  ca.innerHTML = `<div class="mat-card">
    <table class="gov-table mat-table">
      <thead><tr><th>Process Area</th><th>Current</th><th>State</th><th>Target</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="mat-card">
    <div class="gov-title"><span>📊 Maturity Levels — Current vs Target</span><span class="timeline-subtitle">solid = current · faded = target</span></div>
    ${chart}
    <div class="mat-legend">${MATURITY_LEVELS.map(l=>`<span class="mat-pill" style="background:${l.color};color:${l.fg};">${l.v} ${l.label}</span>`).join("")}</div>
  </div>`;
}

async function updateMaturity(id, field, value) {
  try { await api(`/api/maturity/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); await refreshData(); }
  catch (e) { alert("Save failed: " + e.message); }
}
async function addMaturityArea() {
  const name = prompt("Area name:", ""); if (!name || !name.trim()) return;
  try { await api(`/api/maturity`, { method: "POST", body: JSON.stringify({ name: name.trim(), current_level: 1, target_level: 3 }) }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}
async function deleteMaturity(id) {
  if (!confirm("Delete this maturity area?")) return;
  try { await api(`/api/maturity/${id}`, { method: "DELETE" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

// ---------- Document Templates ----------
function renderTemplatesView(ca) {
  if (!templates.length) {
    ca.innerHTML = `<div class="mat-card"><div class="gantt-empty">No templates yet. Click <b>+ Template</b>.</div></div>`;
    return;
  }
  const rows = templates.map(t => `<tr>
    <td style="width:42px;text-align:center;"><input value="${esc(t.icon||'')}" maxlength="4" onchange="updateTemplate(${t.id},'icon',this.value)" style="text-align:center;font-size:18px;"></td>
    <td><input value="${esc(t.title)}" onchange="updateTemplate(${t.id},'title',this.value)" placeholder="Template name"></td>
    <td><input value="${esc(t.url||'')}" onchange="updateTemplate(${t.id},'url',this.value)" placeholder="Paste OneDrive / SharePoint / Drive URL">${t.url?` <a class="gov-link-a" href="${esc(t.url)}" target="_blank" rel="noopener" title="Open in new tab">↗</a>`:''}</td>
    <td><input value="${esc(t.description||'')}" onchange="updateTemplate(${t.id},'description',this.value)" placeholder="Optional description"></td>
    <td class="gov-del" onclick="deleteTemplate(${t.id})" title="Delete">×</td>
  </tr>`).join("");
  ca.innerHTML = `<div class="mat-card">
    <table class="gov-table">
      <thead><tr><th></th><th>Title</th><th>URL</th><th>Description</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderTemplateChips() {
  if (!templates.length) return "";
  const chips = templates.map(t => {
    const hasUrl = !!(t.url && t.url.trim());
    const opener = hasUrl
      ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" class="tpl-chip" title="${esc(t.description||t.title)}">${esc(t.icon||'📄')} ${esc(t.title)} <span class="tpl-chip-arrow">↗</span></a>`
      : `<span class="tpl-chip tpl-chip-empty" title="No URL set yet — add it in Views → Templates" onclick="switchView('templates')">${esc(t.icon||'📄')} ${esc(t.title)} <span style="color:#9ca3af;font-size:10px;">no link</span></span>`;
    return opener;
  }).join("");
  return `<div class="gov-card" style="padding:12px 14px;">
    <div class="gov-title" style="margin-bottom:8px;"><span>📄 Document Templates</span><span class="timeline-subtitle"><a class="gov-link-a" onclick="switchView('templates')" style="cursor:pointer;">Manage →</a></span></div>
    <div class="tpl-chips">${chips}</div>
  </div>`;
}

async function updateTemplate(id, field, value) {
  try { await api(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); await refreshData(); }
  catch (e) { alert("Save failed: " + e.message); }
}
async function addTemplate() {
  const title = prompt("Template name (e.g. 'Test Plan Template'):", ""); if (!title || !title.trim()) return;
  try { await api(`/api/templates`, { method: "POST", body: JSON.stringify({ title: title.trim() }) }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}
async function deleteTemplate(id) {
  if (!confirm("Delete this template entry?")) return;
  try { await api(`/api/templates/${id}`, { method: "DELETE" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

// ---------- Team (users) ----------
function renderTeamView(ca) {
  const isAdmin = currentUser && currentUser.role === "admin";
  if (!users.length) {
    ca.innerHTML = `<div class="mat-card"><div class="gantt-empty">No users yet.${isAdmin?` Click <b>+ Add user</b>.`:''}</div></div>`;
    return;
  }
  const roleCell = (u) => {
    if (!isAdmin) return `<span class="status-pill ${u.role==='admin'?'in_progress':'not_started'}">${esc(u.role)}</span>`;
    const opts = [["member","Member"],["admin","Admin"]].map(([v,l]) => `<option value="${v}" ${u.role===v?'selected':''}>${l}</option>`).join("");
    return `<select class="mat-sel" onchange="updateUserRole(${u.id}, this.value)">${opts}</select>`;
  };
  const rows = users.map(u => {
    const isSelf = currentUser && currentUser.id === u.id;
    const joined = u.created_at ? esc(String(u.created_at).slice(0,10)) : "—";
    const actionsCell = isAdmin
      ? `<td style="width:90px;white-space:nowrap;text-align:right;">
          <span style="cursor:pointer;font-size:14px;" onclick="resetPassword(${u.id})" title="Reset password">🔑</span>
          ${!isSelf?`<span style="cursor:pointer;font-size:16px;color:#ef4444;margin-left:12px;" onclick="deleteUser(${u.id})" title="Remove user">×</span>`:''}
        </td>`
      : `<td></td>`;
    return `<tr>
      <td style="min-width:160px;"><b>${esc(u.name)}</b>${isSelf?` <span style="font-size:10px;color:#6366f1;font-weight:600;">(you)</span>`:''}</td>
      <td>${esc(u.email)}</td>
      <td style="width:140px;">${roleCell(u)}</td>
      <td style="width:120px;color:#6b7280;">${joined}</td>
      ${actionsCell}
    </tr>`;
  }).join("");
  ca.innerHTML = `<div class="mat-card">
    <table class="gov-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function openNewUserModal() {
  ["user-modal-name","user-modal-email","user-modal-password"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("user-modal-role").value = "member";
  document.getElementById("user-modal-bg").classList.add("show");
  setTimeout(()=>document.getElementById("user-modal-name").focus(), 50);
}
function closeUserModal() { document.getElementById("user-modal-bg").classList.remove("show"); }
async function submitNewUser() {
  const name = document.getElementById("user-modal-name").value.trim();
  const email = document.getElementById("user-modal-email").value.trim();
  const password = document.getElementById("user-modal-password").value;
  const role = document.getElementById("user-modal-role").value;
  if (!name || !email) { alert("Name and email are required"); return; }
  if (!password || password.length < 6) { alert("Password must be at least 6 characters"); return; }
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify({ name, email, password, role }) });
    closeUserModal();
    await refreshData();
  } catch (e) { alert("Failed: " + e.message); }
}
async function updateUserRole(id, role) {
  try { await api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }); await refreshData(); pulseSaved(); }
  catch (e) { alert("Failed: " + e.message); await refreshData(); }
}
async function resetPassword(id) {
  const u = users.find(x => x.id === id); if (!u) return;
  const pw = prompt(`Set a new password for ${u.name} (${u.email}).\n\nMinimum 6 characters. Share it with them securely — they can use it to log in immediately.`, "");
  if (pw === null) return; // cancelled
  if (pw.length < 6) { alert("Password must be at least 6 characters."); return; }
  try {
    await api(`/api/users/${id}/password`, { method: "POST", body: JSON.stringify({ password: pw }) });
    alert(`Password reset for ${u.name}.`);
    pulseSaved();
  } catch (e) { alert("Failed: " + e.message); }
}
async function deleteUser(id) {
  const u = users.find(x => x.id === id); if (!u) return;
  if (!confirm(`Remove ${u.name} (${u.email})?\n\nTheir account is deleted and they can no longer log in. Past activity in the audit log is preserved.`)) return;
  try { await api(`/api/users/${id}`, { method: "DELETE" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

// ---------- Partnership Principles ----------
function renderPrinciplesView(ca) {
  if (!principles.length) {
    ca.innerHTML = `<div class="mat-card"><div class="gantt-empty">No principles yet. Click <b>+ Principle</b>.</div></div>`;
    return;
  }
  ca.innerHTML = principles.map(p => `<div class="prin-card">
    <div class="prin-head">
      <span class="prin-num">#${p.num||''}</span>
      <input class="prin-title" value="${esc(p.title)}" onchange="updatePrinciple(${p.id},'title',this.value)">
      <span class="gov-del" onclick="deletePrinciple(${p.id})" title="Delete">×</span>
    </div>
    <textarea class="prin-body" placeholder="Describe this principle…" onchange="updatePrinciple(${p.id},'body',this.value)">${esc(p.body||'')}</textarea>
  </div>`).join("");
}

async function updatePrinciple(id, field, value) {
  try { await api(`/api/principles/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); pulseSaved(); }
  catch (e) { alert("Save failed: " + e.message); }
}
async function addPrinciple() {
  const title = prompt("Principle title:", ""); if (!title || !title.trim()) return;
  try { await api(`/api/principles`, { method: "POST", body: JSON.stringify({ title: title.trim() }) }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}
async function deletePrinciple(id) {
  if (!confirm("Delete this principle?")) return;
  try { await api(`/api/principles/${id}`, { method: "DELETE" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

function tasksForSprint(sprintId) {
  const out = [];
  processes.forEach(p => (p.tasks || []).forEach(t => { if (t.sprint_id === sprintId) out.push({ proc: p, task: t }); }));
  return out;
}

function sprintStatusCounts(items) {
  const c = { total: items.length, completed: 0, in_progress: 0, blocked: 0, not_started: 0, sub_total: 0, sub_done: 0 };
  items.forEach(x => {
    const t = x.task || x;
    if (t.status === "completed") c.completed++;
    else if (t.status === "in_progress") c.in_progress++;
    else if (t.status === "blocked") c.blocked++;
    else c.not_started++;
    (t.subitems || []).forEach(s => { c.sub_total++; if (s.done) c.sub_done++; });
  });
  c.pct = c.total ? Math.round(c.completed / c.total * 100) : 0;
  c.sub_pct = c.sub_total ? Math.round(c.sub_done / c.sub_total * 100) : 0;
  return c;
}

function statusBreakdownChips(c) {
  return `<span class="status-chip done" title="Completed">✓ ${c.completed}</span>
    <span class="status-chip prog" title="In progress">⏳ ${c.in_progress}</span>
    <span class="status-chip block" title="Blocked">⛔ ${c.blocked}</span>
    <span class="status-chip todo" title="Not started">○ ${c.not_started}</span>`;
}

function stackedBar(c) {
  if (!c.total) return `<div class="stack-bar"><div class="stack-bar-empty">No tasks</div></div>`;
  const seg = (cls, n) => n ? `<div class="stack-seg ${cls}" style="flex:${n};" title="${n}"></div>` : "";
  return `<div class="stack-bar">${seg("done",c.completed)}${seg("prog",c.in_progress)}${seg("block",c.blocked)}${seg("todo",c.not_started)}</div>`;
}

function renderSprintOverview(filtered) {
  // 'filtered' = current visible items respecting sprintFilters; we also compute full totals
  const allItems = [];
  sprints.forEach(s => allItems.push(...tasksForSprint(s.id)));
  const full = sprintStatusCounts(allItems);
  const view = sprintStatusCounts(filtered);
  const sCounts = { total: sprints.length, active: sprints.filter(s=>s.status==='active').length, planned: sprints.filter(s=>s.status==='planned').length, completed: sprints.filter(s=>s.status==='completed').length };
  const filterActive = !!(sprintFilters.owner || sprintFilters.status);

  return `<div class="sprint-overview">
    <div class="overview-row">
      <div class="overview-block">
        <div class="overview-label">Sprints</div>
        <div class="overview-big">${sCounts.total}</div>
        <div class="overview-sub">${sCounts.active} active · ${sCounts.planned} planned · ${sCounts.completed} done</div>
      </div>
      <div class="overview-block grow">
        <div class="overview-label">Tasks ${filterActive?`<span class="filter-tag">filtered</span>`:""}</div>
        <div class="overview-row" style="gap:14px;align-items:baseline;">
          <div class="overview-big">${filterActive ? view.total : full.total}<span class="overview-pct">  ${filterActive ? view.pct : full.pct}%</span></div>
          ${filterActive ? `<div class="overview-sub">of ${full.total} total · ${full.pct}% overall</div>` : ""}
        </div>
        ${stackedBar(filterActive ? view : full)}
        <div class="overview-sub" style="margin-top:6px;">${statusBreakdownChips(filterActive ? view : full)}</div>
      </div>
      <div class="overview-block">
        <div class="overview-label">Sub-action items</div>
        <div class="overview-big">${full.sub_done}/${full.sub_total}<span class="overview-pct">  ${full.sub_pct}%</span></div>
        <div class="overview-sub">checked across every sprint task</div>
      </div>
    </div>
  </div>`;
}

function renderSprintsView(ca) {
  if (!sprints.length) {
    ca.innerHTML = `<div class="gov-card"><div class="gantt-empty">No sprints yet. Click <b>+ New Sprint</b> (top right) to create a shared sprint, then add tasks from any process.</div></div>`;
    return;
  }
  const statusOpts = (s) => [["planned","Planned"],["active","Active"],["completed","Completed"]]
    .map(([v,l]) => `<option value="${v}" ${s.status===v?'selected':''}>${l}</option>`).join("");

  const matchesFilter = (t) => {
    if (sprintFilters.owner && (t.owner || "").trim() !== sprintFilters.owner) return false;
    if (sprintFilters.status && t.status !== sprintFilters.status) return false;
    return true;
  };
  const anyFilter = !!(sprintFilters.owner || sprintFilters.status);

  // Aggregate everything currently visible (across all sprints, respecting filters)
  const aggregateVisible = [];
  sprints.forEach(s => tasksForSprint(s.id).forEach(x => { if (matchesFilter(x.task)) aggregateVisible.push(x); }));
  const overviewHtml = renderSprintOverview(aggregateVisible);

  ca.innerHTML = overviewHtml + sprints.map(s => {
    const items = tasksForSprint(s.id);                       // unfiltered (truthful counts)
    const visible = items.filter(x => matchesFilter(x.task)); // what to display
    const sCounts = sprintStatusCounts(items);
    const done = sCounts.completed;
    const pct = sCounts.pct;
    // group filtered tasks by process
    const groups = {};
    visible.forEach(x => { (groups[x.proc.id] = groups[x.proc.id] || { proc: x.proc, tasks: [] }).tasks.push(x.task); });
    const filterCountTag = anyFilter ? ` <span class="sprint-prog" style="background:#eef2ff;color:#4338ca;padding:1px 8px;border-radius:100px;font-size:11px;">${visible.length} match</span>` : "";
    const groupsHtml = Object.values(groups).map(g =>
      `<div style="margin-top:10px;"><div class="phase-section-label">${g.proc.icon || iconFor(g.proc.slug)} ${esc(g.proc.title)} · ${g.tasks.length}</div>
        <div class="tasks-grid">${g.tasks.map(t => renderTaskCard(g.proc, t)).join("")}</div></div>`
    ).join("");

    const header = `<div class="sprint-head status-${s.status}" style="margin-bottom:12px;">
      <input class="sprint-name" value="${esc(s.name)}" onchange="updateSprint(${s.id},'name',this.value)">
      <span class="sprint-meta">
        <input type="date" value="${esc(s.start_date||'')}" title="Start" onchange="updateSprint(${s.id},'start_date',this.value)">→
        <input type="date" value="${esc(s.end_date||'')}" title="End" onchange="updateSprint(${s.id},'end_date',this.value)">
      </span>
      <select class="sprint-status-sel" onchange="updateSprint(${s.id},'status',this.value)">${statusOpts(s)}</select>
      <span class="sprint-prog">${done}/${items.length} · ${pct}%${filterCountTag}<span class="sprint-prog-track"><span class="sprint-prog-fill" style="width:${pct}%"></span></span></span>
      <span class="sprint-prog" style="display:flex;gap:4px;align-items:center;">${statusBreakdownChips(sCounts)}${sCounts.sub_total?`<span class="status-chip sub" title="Sub-action items">☑ ${sCounts.sub_done}/${sCounts.sub_total}</span>`:""}</span>
      <span class="sprint-actions"><button class="btn" style="color:#dc2626;" onclick="deleteSprint(${s.id})" title="Delete sprint">🗑</button></span>
      <input class="sprint-name" style="flex-basis:100%;font-weight:400;font-size:12px;color:#4b5563;" placeholder="🎯 Sprint goal…" value="${esc(s.goal||'')}" onchange="updateSprint(${s.id},'goal',this.value)">
    </div>`;

    let body;
    if (!items.length) body = '<div style="font-size:12px;color:#9ca3af;padding:6px 2px;">No tasks yet. Open any process and use the 🏃 dropdown on a task (or the task\'s Sprint field) to add it here.</div>';
    else if (!visible.length) body = `<div style="font-size:12px;color:#9ca3af;padding:6px 2px;">No tasks match the current filter${sprintFilters.owner?` (${esc(sprintFilters.owner)})`:""}${sprintFilters.status?` (${esc(sprintFilters.status.replace("_"," "))})`:""}.</div>`;
    else body = groupsHtml;
    return `<div class="gov-card">${header}${body}</div>`;
  }).join("");
}

// ---------- Notes editor (rich text in task modal) ----------
function notesFormat(cmd) {
  const el = document.getElementById("modal-notes");
  if (!el) return;
  el.focus();
  document.execCommand(cmd, false, null);
}
function looksLikeHtml(s) { return /<\/?(b|i|u|ul|ol|li|p|br|strong|em)\b/i.test(String(s||"")); }
// Allow only a tiny set of formatting tags; strip everything else, drop attributes and script/style.
function sanitizeNotesHtml(html) {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = String(html);
  const allowed = new Set(["B","STRONG","I","EM","U","UL","OL","LI","P","BR","DIV","SPAN"]);
  const walk = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === 1) {
        if (!allowed.has(child.tagName)) { child.replaceWith(...child.childNodes); return; }
        [...child.attributes].forEach(a => child.removeAttribute(a.name));
        walk(child);
      } else if (child.nodeType !== 3) { child.remove(); }
    });
  };
  walk(tmp);
  return tmp.innerHTML;
}

// ---------- Modal ----------
function openModal(taskId) {
  const [proc, t] = findTaskById(taskId); if (!t) return;
  currentTaskEditing = taskId;
  document.getElementById("modal-title").value = t.title;
  document.getElementById("modal-status").value = t.status;
  document.getElementById("modal-owner").value = t.owner || "";
  document.getElementById("modal-due").value = t.due_date || "";
  // Notes: store HTML; if existing notes look like plain text, keep them as text (contenteditable handles both)
  const notesEl = document.getElementById("modal-notes");
  const raw = t.notes || "";
  notesEl.innerHTML = looksLikeHtml(raw) ? sanitizeNotesHtml(raw) : esc(raw).replace(/\n/g, "<br>");
  notesEl.setAttribute("data-placeholder", "Add notes… (use the toolbar for bullets, numbering, bold)");
  // Sprint dropdown (Backlog + all shared sprints)
  const sprintSel = document.getElementById("modal-sprint");
  sprintSel.innerHTML = `<option value="">📥 Backlog (unassigned)</option>` +
    sprints.map(s => `<option value="${s.id}" ${t.sprint_id===s.id?'selected':''}>${esc(s.name)}</option>`).join("");
  sprintSel.value = t.sprint_id ? String(t.sprint_id) : "";
  renderModalSubs();
  document.getElementById("modal-bg").classList.add("show");
  setTimeout(()=>document.getElementById("modal-title").focus(), 50);
}

async function closeModal() {
  if (currentTaskEditing) {
    const [, t] = findTaskById(currentTaskEditing);
    if (t) {
      try {
        await api(`/api/tasks/${currentTaskEditing}`, { method: "PATCH", body: JSON.stringify({
          title: document.getElementById("modal-title").value.trim() || "Untitled",
          status: document.getElementById("modal-status").value,
          owner: document.getElementById("modal-owner").value.trim(),
          due_date: document.getElementById("modal-due").value || null,
          notes: sanitizeNotesHtml(document.getElementById("modal-notes").innerHTML).trim(),
          sprint_id: document.getElementById("modal-sprint").value || null
        })});
        await refreshData();
      } catch (e) { alert("Save failed: " + e.message); }
    }
  }
  currentTaskEditing = null;
  document.getElementById("modal-bg").classList.remove("show");
}

function renderModalSubs() {
  if (!currentTaskEditing) return;
  const [, t] = findTaskById(currentTaskEditing); if (!t) return;
  document.getElementById("modal-subitems").innerHTML = (t.subitems||[]).map(s=>`<div class="subitem-row ${s.done?'done':''}"><input type="checkbox" ${s.done?'checked':''} onchange="modalToggleSub(${s.id}, this.checked)"><span class="subitem-text" contenteditable="true" onblur="modalUpdateSub(${s.id}, this.textContent)">${esc(s.text)}</span><span class="subitem-del" onclick="modalRemoveSub(${s.id})">×</span></div>`).join("");
}

async function modalToggleSub(id, done) {
  try { await api(`/api/subitems/${id}`, { method: "PATCH", body: JSON.stringify({ done }) }); await refreshData(); renderModalSubs(); }
  catch (e) { alert("Failed: " + e.message); }
}
async function modalUpdateSub(id, text) {
  try { await api(`/api/subitems/${id}`, { method: "PATCH", body: JSON.stringify({ text: text.trim() }) }); await refreshData(); }
  catch (e) {}
}
async function modalRemoveSub(id) {
  try { await api(`/api/subitems/${id}`, { method: "DELETE" }); await refreshData(); renderModalSubs(); }
  catch (e) {}
}
async function modalAddSubitem() {
  if (!currentTaskEditing) return;
  try { await api(`/api/tasks/${currentTaskEditing}/subitems`, { method: "POST", body: JSON.stringify({ text: "New sub-action" }) }); await refreshData(); renderModalSubs(); }
  catch (e) {}
}
async function modalDeleteTask() {
  if (!currentTaskEditing) return;
  if (!confirm("Delete this task permanently?")) return;
  try { await api(`/api/tasks/${currentTaskEditing}`, { method: "DELETE" }); currentTaskEditing = null; document.getElementById("modal-bg").classList.remove("show"); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

document.addEventListener("keydown", e => { if (e.key === "Escape" && document.getElementById("modal-bg").classList.contains("show")) closeModal(); });

// ---------- Process CRUD ----------
const SUGGESTED_PROC_ICONS = [
  "🤖","🧪","👥","📋","🎬","📚","🛠","📊","📈","💼",
  "🎯","🔧","💻","☁️","🔐","🚀","🗂","📁","✅","⚙️",
  "🧠","📝","🏗","🔍","🌐","📞","💡","🎨","🔔","🧩"
];
function populateIconPicker() {
  const inp = document.getElementById("proc-modal-icon");
  const cur = (inp && inp.value || "").trim();
  const grid = document.getElementById("proc-icon-picker");
  if (!grid) return;
  grid.innerHTML = SUGGESTED_PROC_ICONS.map(e =>
    `<button type="button" class="${e===cur?'selected':''}" title="${e}" onclick="pickProcIcon('${e}')">${e}</button>`
  ).join("");
}
function pickProcIcon(emoji) {
  document.getElementById("proc-modal-icon").value = emoji;
  populateIconPicker();
}
function syncIconPickerSelection() { populateIconPicker(); }

function openNewProcessModal() {
  ["proc-modal-title","proc-modal-icon","proc-modal-subtitle","proc-modal-meta","proc-modal-desc"].forEach(id => document.getElementById(id).value = "");
  populateIconPicker();
  document.getElementById("proc-modal-bg").classList.add("show");
  setTimeout(()=>document.getElementById("proc-modal-title").focus(), 50);
}
function closeProcModal() { document.getElementById("proc-modal-bg").classList.remove("show"); }
async function submitNewProcess() {
  const title = document.getElementById("proc-modal-title").value.trim();
  if (!title) { alert("Process title is required"); return; }
  const payload = {
    title,
    icon: document.getElementById("proc-modal-icon").value.trim() || null,
    subtitle: document.getElementById("proc-modal-subtitle").value.trim() || null,
    meta: document.getElementById("proc-modal-meta").value.trim() || null,
    description: document.getElementById("proc-modal-desc").value.trim() || null
  };
  try {
    const r = await api("/api/processes", { method: "POST", body: JSON.stringify(payload) });
    closeProcModal();
    await refreshData();
    switchView("process:" + r.slug);
  } catch (e) { alert("Failed: " + e.message); }
}
async function deleteProcess(id) {
  const p = processes.find(x => x.id === id); if (!p) return;
  if (!confirm(`Delete process "${p.title}"?\n\nThis removes all its tasks and sub-items. Cannot be undone.`)) return;
  try {
    await api(`/api/processes/${id}`, { method: "DELETE" });
    switchView("processes-all");
    await refreshData();
  } catch (e) { alert("Failed: " + e.message); }
}

// ---------- Project CRUD ----------
function openNewProjectModal() {
  ["proj-modal-title","proj-modal-client","proj-modal-pm","proj-modal-tl","proj-modal-ba","proj-modal-qa","proj-modal-sa","proj-modal-start","proj-modal-golive","proj-modal-notes"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("proj-modal-template").value = "pdom_normal";
  document.getElementById("proj-modal-sprints").value = "1";
  document.getElementById("proj-modal-uat").value = "1";
  document.getElementById("proj-modal-bg").classList.add("show");
  setTimeout(()=>document.getElementById("proj-modal-title").focus(), 50);
}
function closeProjModal() { document.getElementById("proj-modal-bg").classList.remove("show"); }
async function submitNewProject() {
  const name = document.getElementById("proj-modal-title").value.trim();
  if (!name) { alert("Project name is required"); return; }
  const payload = {
    name,
    client: document.getElementById("proj-modal-client").value.trim(),
    pm: document.getElementById("proj-modal-pm").value.trim(),
    tech_lead: document.getElementById("proj-modal-tl").value.trim(),
    ba: document.getElementById("proj-modal-ba").value.trim(),
    qa_lead: document.getElementById("proj-modal-qa").value.trim(),
    sa: document.getElementById("proj-modal-sa").value.trim(),
    start_date: document.getElementById("proj-modal-start").value || null,
    go_live_date: document.getElementById("proj-modal-golive").value || null,
    notes: document.getElementById("proj-modal-notes").value.trim(),
    phase_template: document.getElementById("proj-modal-template").value,
    dev_sprints: +document.getElementById("proj-modal-sprints").value || 1,
    uat_rounds: +document.getElementById("proj-modal-uat").value || 1
  };
  try {
    const r = await api("/api/projects", { method: "POST", body: JSON.stringify(payload) });
    closeProjModal();
    await refreshData();
    switchView("project:" + r.slug);
  } catch (e) { alert("Failed: " + e.message); }
}
async function deleteProject(id) {
  const pr = projects.find(p => p.id === id); if (!pr) return;
  if (!confirm(`Delete project "${pr.name}"?\n\nThis removes all phases, prerequisites and project data. Cannot be undone.`)) return;
  try {
    await api(`/api/projects/${id}`, { method: "DELETE" });
    switchView("projects-all");
    await refreshData();
  } catch (e) { alert("Failed: " + e.message); }
}

// ---------- Governance CRUD ----------
async function updateGov(id, field, value) {
  try { await api(`/api/governance/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); await refreshData(); }
  catch (e) { alert("Save failed: " + e.message); }
}
async function addGov(projId) {
  const title = prompt("Governance item name:", "");
  if (!title || !title.trim()) return;
  try { await api(`/api/projects/${projId}/governance`, { method: "POST", body: JSON.stringify({ title: title.trim() }) }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}
async function deleteGov(id) {
  if (!confirm("Delete this governance item?")) return;
  try { await api(`/api/governance/${id}`, { method: "DELETE" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

// ---------- Phase CRUD ----------
function openNewPhaseModal(projId) {
  document.getElementById("phase-modal-bg").dataset.projId = projId;
  ["phase-modal-title","phase-modal-owner","phase-modal-approver","phase-modal-prereqs"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("phase-modal-bg").classList.add("show");
  setTimeout(()=>document.getElementById("phase-modal-title").focus(), 50);
}
function closePhaseModal() { document.getElementById("phase-modal-bg").classList.remove("show"); }
async function submitNewPhase() {
  const projId = +document.getElementById("phase-modal-bg").dataset.projId;
  const name = document.getElementById("phase-modal-title").value.trim();
  if (!name) { alert("Phase name is required"); return; }
  const prereqs = document.getElementById("phase-modal-prereqs").value.split("\n").map(s=>s.trim()).filter(Boolean);
  try {
    await api(`/api/projects/${projId}/phases`, { method: "POST", body: JSON.stringify({
      name,
      owner: document.getElementById("phase-modal-owner").value.trim(),
      approver: document.getElementById("phase-modal-approver").value.trim(),
      prerequisites: prereqs
    })});
    closePhaseModal();
    await refreshData();
  } catch (e) { alert("Failed: " + e.message); }
}
async function updatePhase(id, field, value) {
  try { await api(`/api/phases/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); await refreshData(); }
  catch (e) { alert("Save failed: " + e.message); }
}
async function deletePhase(id) {
  if (!confirm("Delete this phase and its prerequisites?")) return;
  try { await api(`/api/phases/${id}`, { method: "DELETE" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

// ---------- Prerequisite CRUD ----------
async function addPrereq(phaseId) {
  const text = prompt("Prerequisite text:", "");
  if (!text || !text.trim()) return;
  try { await api(`/api/phases/${phaseId}/prerequisites`, { method: "POST", body: JSON.stringify({ text: text.trim() }) }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}
async function updatePrereqText(id, text) {
  const trimmed = (text||"").trim();
  if (!trimmed) return;
  try { await api(`/api/prerequisites/${id}`, { method: "PATCH", body: JSON.stringify({ text: trimmed }) }); }
  catch (e) {}
}
async function deletePrereq(id) {
  if (!confirm("Delete this prerequisite?")) return;
  try { await api(`/api/prerequisites/${id}`, { method: "DELETE" }); await refreshData(); }
  catch (e) { alert("Failed: " + e.message); }
}

function renderAll() { renderSidebar(); renderTiles(); renderTopbar(); renderContent(); }

boot();
