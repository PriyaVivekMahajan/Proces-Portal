// ============================================================
// Seed data — the same content as your local HTML dashboard
// ============================================================
const PHASE_TEMPLATE = [
  { name: "Create Epic", owner: "Product Owner", approver: "Product Owner", prerequisites: ["Azure access verified"] },
  { name: "Create Feature", owner: "Product Owner", approver: "Product Owner", prerequisites: ["Approved BRD"] },
  { name: "BRD & Artifacts", owner: "Product Owner", approver: "Pankaj Patil (Delivery Head)", prerequisites: ["BRD prepared", "Project Plan attached", "SOW signed", "Client sign-off received"] },
  { name: "Project Kickoff", owner: "Product Owner", approver: "Product Owner", prerequisites: ["Signed BRD", "Internal team aligned"] },
  { name: "FSD Preparation", owner: "BA Lead", approver: "BA Lead", prerequisites: ["Approved BRD"] },
  { name: "FSD Walkthrough", owner: "BA Lead", approver: "BA Lead", prerequisites: ["FSD ready", "Stakeholder walkthrough scheduled"] },
  { name: "Design", owner: "Dev Lead", approver: "Solution Architect", prerequisites: ["FSD sign-off from client & BA"] },
  { name: "Development", owner: "Dev Lead", approver: "Dev Lead", prerequisites: ["Approved Design"] },
  { name: "Code Review", owner: "Dev Lead", approver: "Solution Architect", prerequisites: ["Development completed"] },
  { name: "CMF Walkthrough", owner: "Change Manager", approver: "Change Manager", prerequisites: ["Implementation Plan", "Impact Assessment", "CMF document"] },
  { name: "SIT Code Migration", owner: "Dev Lead", approver: "Dev Lead", prerequisites: ["Approved CMF"] },
  { name: "SIT Testing", owner: "QA Manager", approver: "QA Manager", prerequisites: ["SIT deployment done"] },
  { name: "UAT Code Migration", owner: "Dev Lead", approver: "Dev Lead", prerequisites: ["SIT sign-off"] },
  { name: "UAT", owner: "QA Manager", approver: "Client", prerequisites: ["UAT deployment", "Client UAT scheduled"] },
  { name: "Test Sign-Off", owner: "QA Manager", approver: "Client", prerequisites: ["UAT completion", "Client confirmation"] },
  { name: "CAB Approval", owner: "Change Manager", approver: "Pankaj Patil (CAB Chairman)", prerequisites: ["SIT sign-off", "UAT sign-off", "Migration plan"] },
  { name: "Finalization (Code Commit)", owner: "Solution Architect", approver: "Solution Architect", prerequisites: ["CAB approval"] },
  { name: "Production Migration", owner: "Deployment Lead", approver: "Pankaj Patil (Delivery Head)", prerequisites: ["Approved Migration Plan", "Production downtime approved"] }
];

const PROCESSES = [
  {
    slug: "ai-initiative", title: "AI Initiative", subtitle: "Common AI Framework", icon: "🤖",
    meta: "Owners: Dinesh Salunke, Priyanka Jadhav (governance), Pankaj Patil (sponsor)",
    description: "Common framework for integrating Agentic AI into processes.",
    tasks: [
      { title: "Create Azure repository for AI corekit", owner: "Priyanka Jadhav", due_date: "2025-05-15", status: "completed", notes: "Done: https://dev.azure.com/Adani-Green-Energy-Ltd/ai-corekit", subitems: [["Repo created", 1], ["Access granted", 1]] },
      { title: "Push initial Claude workflow from Pre-Com HOTO", owner: "Dinesh Salunke", due_date: "2025-06-05", status: "in_progress", notes: "Pending update", subitems: [["Clean up files", 0], ["Push to repo", 0], ["Share commit link", 0]] },
      { title: "Setup README and repo usage documentation", owner: "Dinesh Salunke", due_date: "2025-06-10", status: "in_progress", notes: "Pending update", subitems: [["Write README.md", 0], ["Workflow usage docs", 0]] },
      { title: "Define governance model for AI processes", owner: "Priyanka Jadhav", due_date: "2025-06-20", status: "in_progress", notes: "", subitems: [["Draft governance doc", 0], ["Review with Pankaj", 0], ["Roll out", 0]] },
      { title: "Claude usage patterns per role", owner: "Dinesh Salunke", due_date: "2025-06-30", status: "not_started", notes: "BA, QA, UI/UX, Dev, SA, TL", subitems: [["BA pattern", 0], ["QA pattern", 0], ["UI/UX pattern", 0], ["Dev pattern", 0], ["TL/SA pattern", 0]] },
      { title: "Setup Claude skills as CI/CD validation step", owner: "Dinesh Salunke", due_date: "2025-07-15", status: "not_started", notes: "", subitems: [] }
    ]
  },
  {
    slug: "qa-process", title: "QA Process", subtitle: "Test automation + team allocation", icon: "🧪",
    meta: "QA Lead: Shubham Dhakate | Team: Vijendra, Vijay, Tanvi, Aman, Jay",
    description: "QA allocation across projects. Azure Test Plan automation done. Deployment email automation pending.",
    tasks: [
      { title: "Fill QA gaps — DRS, Pulse, Cement, Gatishakti", owner: "Shubham Dhakate", due_date: "2025-06-10", status: "in_progress", notes: "QA Required rows", subitems: [["DRS QA Junior", 0], ["Pulse QA Junior", 0], ["Cement QA Junior", 0], ["Gatishakti QA Lead", 0], ["Gatishakti QA Junior", 0]] },
      { title: "Test automation — Azure Test Plan execution", owner: "Shubham Dhakate", due_date: "2025-05-20", status: "completed", notes: "Updates results back to Azure Boards", subitems: [["Build script", 1], ["Connect Azure API", 1], ["Validate flow", 1]] },
      { title: "Deployment email automation", owner: "Tejas", due_date: "2025-06-15", status: "in_progress", notes: "QA needs email from TL about deployment", subitems: [["Define triggers", 0], ["Email template", 0], ["Hook pipeline", 0], ["Test end-to-end", 0]] },
      { title: "HOTO Unit Testing process definition", owner: "Supriya Chaughule", due_date: "2025-06-20", status: "in_progress", notes: "", subitems: [["Draft process doc", 0], ["Review with TLs", 0], ["Roll out", 0]] },
      { title: "ISTQB + Cypress training for QA team", owner: "Shubham Dhakate", due_date: "2025-07-30", status: "not_started", notes: "Per Q2 Learning Plan", subitems: [["ISTQB study", 0], ["15 Cypress tests", 0], ["fCC QA cert", 0]] }
    ]
  },
  {
    slug: "scrum-of-scrum", title: "Scrum of Scrums", subtitle: "Every Tuesday — Adani PMs", icon: "👥",
    meta: "Tuesday | 60–90 min | All Adani PMs",
    description: "Weekly cross-project sync. PMs prepare by Monday EOD.",
    tasks: [
      { title: "Monday EOD prep", owner: "All PMs", due_date: null, status: "in_progress", notes: "Weekly", subitems: [["Project status", 0], ["Blockers & risks", 0], ["Resource needs", 0], ["KT topic", 0]] },
      { title: "Tuesday SoS meeting", owner: "All PMs", due_date: null, status: "in_progress", notes: "MoM within 2 hrs", subitems: [["Opening", 0], ["Round-robin", 0], ["Blockers", 0], ["Resource sharing", 0], ["KT spotlight", 0], ["Close", 0]] },
      { title: "Challenge: PM-client communication", owner: "Vishwajit Shinde", due_date: "2025-06-10", status: "in_progress", notes: "", subitems: [["Discuss in PM call", 0], ["Propose approach", 0], ["Roll out", 0]] },
      { title: "Challenge: Precom HOTO process alignment", owner: "Umang Mittal", due_date: "2025-06-15", status: "in_progress", notes: "Tight deadlines", subitems: [["Identify pinch points", 0], ["Mitigation", 0]] },
      { title: "Effort estimation approach", owner: "Raj Sable", due_date: "2025-06-25", status: "in_progress", notes: "", subitems: [["Research techniques", 0], ["Draft template", 0], ["Pilot", 0], ["Roll out", 0]] },
      { title: "Monday reminder + MoM templates", owner: "Priyanka Jadhav", due_date: "2025-06-05", status: "not_started", notes: "", subitems: [["Monday reminder", 0], ["MoM template", 0]] }
    ]
  },
  {
    slug: "pm-process", title: "PM Process", subtitle: "PDOM + Azure + Wiki", icon: "📋",
    meta: "PDOM V1.0 published Feb 2026",
    description: "Project Delivery Operating Model. Normal CR, Unscheduled, Bug Fix, Emergency, BAU flows.",
    tasks: [
      { title: "PDOM V1.0 published", owner: "Priyanka Jadhav", due_date: "2026-02-22", status: "completed", notes: "Approvers: Pankaj Patil, Subhransu Majhi", subitems: [["Draft prepared", 1], ["Pankaj approval", 0], ["Subhransu approval", 0], ["Publish", 0]] },
      { title: "Change Management Process Guide V1.0", owner: "Priyanka Jadhav", due_date: "2026-02-22", status: "completed", notes: "", subitems: [["Draft prepared", 1], ["Approvals", 0], ["Publish", 0]] },
      { title: "Deliverables & Acceptance Criteria V1.0", owner: "Priyanka Jadhav", due_date: "2026-02-22", status: "completed", notes: "", subitems: [["Draft prepared", 1], ["Approvals", 0], ["Publish", 0]] },
      { title: "Software Deployment & Release Mgmt V1.0", owner: "Priyanka Jadhav", due_date: "2026-02-20", status: "completed", notes: "", subitems: [["Draft prepared", 1], ["Approvals", 0], ["Publish", 0]] },
      { title: "Azure Wiki Page Structure V1.0", owner: "Priyanka Jadhav", due_date: "2026-02-22", status: "completed", notes: "", subitems: [["Draft prepared", 1], ["Approvals", 0], ["Apply", 0]] },
      { title: "SRS Template V1.0", owner: "Priyanka Jadhav", due_date: "2026-02-22", status: "completed", notes: "", subitems: [["Template ready", 1], ["Distribute", 0]] },
      { title: "Project Plan Template", owner: "Priyanka Jadhav", due_date: "2026-02-22", status: "completed", notes: "", subitems: [["Template ready", 1], ["Distribute", 0]] },
      { title: "Change Request Template", owner: "Priyanka Jadhav", due_date: "2026-02-22", status: "completed", notes: "", subitems: [["Template ready", 1], ["Distribute", 0]] },
      { title: "Azure Boards setup per project", owner: "Priyanka Jadhav", due_date: "2026-06-15", status: "in_progress", notes: "", subitems: [["Standard template", 0], ["DRS", 0], ["Pulse", 0], ["HOTO", 0], ["Gatishakti", 0], ["Cement", 0]] },
      { title: "Azure Wiki rollout to all projects", owner: "Priyanka Jadhav", due_date: "2026-06-30", status: "in_progress", notes: "", subitems: [["DRS wiki", 0], ["Pulse wiki", 0], ["HOTO wiki", 0], ["Gatishakti wiki", 0], ["Cement wiki", 0]] },
      { title: "Define Escalation Matrix", owner: "Priyanka Jadhav", due_date: "2026-06-15", status: "not_started", notes: "TBD", subitems: [] }
    ]
  },
  {
    slug: "videos", title: "Demo Videos", subtitle: "Adani BU client demos", icon: "🎬",
    meta: "1920×1080 min | 3–5 min | Approver: Pankaj Patil",
    description: "Demo videos for client meetings.",
    tasks: [
      { title: "DRS demo video (Desktop)", owner: "Any team member", due_date: "2025-06-10", status: "in_progress", notes: "", subitems: [["Script", 0], ["Approval", 0], ["Recording", 0], ["Deliver", 0]] },
      { title: "GatiShakti demo video (Desktop)", owner: "Any team member", due_date: "2025-06-12", status: "in_progress", notes: "", subitems: [["Script", 0], ["Approval", 0], ["Recording", 0], ["Deliver", 0]] },
      { title: "Pulse demo video (Mobile)", owner: "Any team member", due_date: "2025-06-14", status: "not_started", notes: "", subitems: [["Script", 0], ["Approval", 0], ["Recording", 0], ["Deliver", 0]] },
      { title: "Pre-Com demo video (Mobile)", owner: "Any team member", due_date: "2025-06-16", status: "not_started", notes: "", subitems: [["Script", 0], ["Approval", 0], ["Recording", 0], ["Deliver", 0]] },
      { title: "HOTO demo video (Mobile)", owner: "Any team member", due_date: "2025-06-18", status: "not_started", notes: "", subitems: [["Script", 0], ["Approval", 0], ["Recording", 0], ["Deliver", 0]] }
    ]
  },
  {
    slug: "training-mentor", title: "Training & Mentor", subtitle: "Q2 Learning + Mentor pairs", icon: "📚",
    meta: "Q2 2025 Learning Plan + Mentor-Mentee 6 projects",
    description: "Full Stack Web compulsory learning.",
    tasks: [
      { title: "Q2 Learning Month 1 (Build)", owner: "All TLs", due_date: "2025-06-15", status: "in_progress", notes: "Weeks 1-4", subitems: [["Week 2 check-in", 0], ["Week 4 check-in", 0]] },
      { title: "Q2 Learning Month 2 (Apply & Certify)", owner: "All TLs", due_date: "2025-07-15", status: "not_started", notes: "Weeks 5-8", subitems: [["Week 6", 0], ["Week 8", 0], ["Demo Day", 0]] },
      { title: "Mentor-Mentee pairings", owner: "Priyanka Jadhav", due_date: null, status: "completed", notes: "Active across 6 projects", subitems: [["DRS", 1], ["Pulse", 1], ["HOTO", 1], ["Gatishakti", 1], ["Adani Engg", 1], ["Cstech", 1]] },
      { title: "Monthly mentor check-ins", owner: "All Mentors", due_date: null, status: "in_progress", notes: "", subitems: [["May", 0], ["June", 0], ["July", 0]] },
      { title: "KRA-KPI quarterly review", owner: "Priyanka Jadhav", due_date: "2025-07-30", status: "not_started", notes: "", subitems: [["Communicate", 0], ["Mid-quarter", 0], ["Review meetings", 0]] }
    ]
  }
];

function projectPhases(progressIndex) {
  return PHASE_TEMPLATE.map((p, i) => ({
    phase_num: i + 1,
    name: p.name,
    owner: p.owner,
    approver: p.approver,
    status: i < progressIndex ? "completed" : (i === progressIndex ? "in_progress" : "locked"),
    prerequisites: p.prerequisites.map(t => ({ text: t, done: i < progressIndex ? 1 : 0 }))
  }));
}

const PROJECTS = [
  { slug: "drs", name: "DRS", client: "Adani Green Energy (AGEL)", pm: "Rathin Pandya", tech_lead: "Mahendra Dambe", ba: "TBD", qa_lead: "Vijay (junior pending)", sa: "TBD", start_date: "2025-04-01", go_live_date: null, rag: ["green","amber","green","amber","green"], notes: "Multiple drops. Devs: Raj, Jatin, Vedank, Kshitij. Tanvi (QA Junior).", phases: projectPhases(8) },
  { slug: "pulse", name: "Pulse", client: "Adani Green Energy (AGEL)", pm: "Umang Mittal", tech_lead: "Supriya Chaughule", ba: "TBD", qa_lead: "Vijendra", sa: "Mankaran Bedi", start_date: "2025-04-01", go_live_date: null, rag: ["green","green","green","amber","green"], notes: "Phase 1 + Phase 2.", phases: projectPhases(11) },
  { slug: "hoto", name: "Pre-Com HOTO", client: "Adani Green Energy (AGEL)", pm: "Umang Mittal", tech_lead: "Supriya Chaughule", ba: "TBD", qa_lead: "Shubham Dhakate", sa: "Mankaran Bedi", start_date: "2025-04-01", go_live_date: null, rag: ["amber","red","green","amber","amber"], notes: "Tight deadlines, many changes.", phases: projectPhases(9) },
  { slug: "gatishakti", name: "Gatishakti", client: "Adani Green Energy (AGEL)", pm: "Vishwajit Shinde", tech_lead: "Shrinath Vaishnav", ba: "Siddharth Srivastava", qa_lead: "TBD", sa: "Shrinath Vaishnav", start_date: "2026-03-25", go_live_date: "2026-07-10", rag: ["green","green","green","green","green"], notes: "Sprint 1 & 2 done. Workstreams include +4 plots, Opportunity Land Analysis, Chatbot.", phases: projectPhases(11) },
  { slug: "cement", name: "Cement", client: "Adani Green Energy (AGEL)", pm: "Suraj Bhanavadiya", tech_lead: "TBD", ba: "TBD", qa_lead: "TBD", sa: "TBD", start_date: null, go_live_date: null, rag: ["amber","amber","green","red","amber"], notes: "Resourcing gap.", phases: projectPhases(3) }
];

function seedDatabase(db) {
  const procCount = db.prepare("SELECT COUNT(*) AS n FROM processes").get().n;
  if (procCount > 0) {
    console.log("⏭  Seed skipped — database already has data.");
    return;
  }

  const insProc = db.prepare("INSERT INTO processes (slug,title,subtitle,icon,meta,description,sort_order) VALUES (?,?,?,?,?,?,?)");
  const insTask = db.prepare("INSERT INTO process_tasks (process_id,title,owner,due_date,status,notes,sort_order) VALUES (?,?,?,?,?,?,?)");
  const insSub  = db.prepare("INSERT INTO task_subitems (task_id,text,done,sort_order) VALUES (?,?,?,?)");
  const insProj = db.prepare("INSERT INTO projects (slug,name,client,pm,tech_lead,ba,qa_lead,sa,start_date,go_live_date,notes,rag_scope,rag_timeline,rag_budget,rag_resources,rag_quality,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insPh   = db.prepare("INSERT INTO project_phases (project_id,phase_num,name,owner,approver,status) VALUES (?,?,?,?,?,?)");
  const insPre  = db.prepare("INSERT INTO phase_prerequisites (phase_id,text,done,sort_order) VALUES (?,?,?,?)");

  const tx = db.transaction(() => {
    PROCESSES.forEach((p, pi) => {
      const procId = insProc.run(p.slug, p.title, p.subtitle, p.icon, p.meta, p.description, pi).lastInsertRowid;
      p.tasks.forEach((t, ti) => {
        const taskId = insTask.run(procId, t.title, t.owner, t.due_date, t.status, t.notes, ti).lastInsertRowid;
        t.subitems.forEach(([txt, done], si) => insSub.run(taskId, txt, done, si));
      });
    });
    PROJECTS.forEach((pr, pi) => {
      const projId = insProj.run(pr.slug, pr.name, pr.client, pr.pm, pr.tech_lead, pr.ba, pr.qa_lead, pr.sa, pr.start_date, pr.go_live_date, pr.notes, pr.rag[0], pr.rag[1], pr.rag[2], pr.rag[3], pr.rag[4], pi).lastInsertRowid;
      pr.phases.forEach(ph => {
        const phId = insPh.run(projId, ph.phase_num, ph.name, ph.owner, ph.approver, ph.status).lastInsertRowid;
        ph.prerequisites.forEach((req, ri) => insPre.run(phId, req.text, req.done, ri));
      });
    });
  });
  tx();
  console.log(`✓ Seeded ${PROCESSES.length} processes, ${PROCESSES.reduce((a,p)=>a+p.tasks.length,0)} tasks, ${PROJECTS.length} projects, ${PROJECTS.length * PHASE_TEMPLATE.length} phases.`);
}

module.exports = { seedDatabase };
