// ============================================================
// One-off importer: seed project↔resource links from the
// "Team Structure" sheet of data/Adani resource (2).xlsx
//
// Idempotent: people are deduped by name; links use INSERT OR IGNORE.
// Run:  node import-resources.js          (writes to the live DB)
//       node import-resources.js --dry    (parse + report only, no writes)
// ============================================================
const path = require("path");
const XLSX = require("xlsx");
const db = require("./db");

const DRY = process.argv.includes("--dry");
const XLSX_PATH = path.join(__dirname, "data", "Adani resource (2).xlsx");
const SHEET = "Team Structure";

// Excel project column  ->  existing DB project name (alias). Unlisted columns are created.
const PROJECT_ALIAS = {
  "DRS": "DRS",
  "Pulse": "Pulse",
  "Precomm-HOTO": "Pre-Com HOTO",
  "Gatishakti": "Gatishakti",
  "Cement WH Digital Twin": "Cement",
};

const KNOWN_ROLES = new Set([
  "execution head", "sdm", "project manager", "solution architect", "technical architect",
  "team lead", "sr. developer", "developer", "qa", "ba", "product owner", "ui/ux",
]);

function slugify(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || ("project-" + Date.now());
}

// Turn a raw cell into { name, category, notes } or null if it isn't a person.
function parsePerson(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  const low = s.toLowerCase();
  let category = "billable";
  if (/contract/.test(low)) category = "contract";
  else if (/resign/.test(low)) category = "resigned";
  else if (/to be hired|to be decided|^to be\b|\bintern\b|new joinee|to be hire/.test(low)) category = "new_hire";

  // Annotations after " - " (dates, locations) and inside parentheses are stripped
  // from the NAME (kept as notes) so the same person dedupes across projects.
  const dashParts = s.split(/\s+-\s+/);
  let name = dashParts[0];
  const noteBits = dashParts.slice(1);
  const parens = [];
  name = name.replace(/\(([^)]*)\)/g, (m, inner) => { parens.push(inner.trim()); return ""; }).replace(/\s+/g, " ").trim();
  const notes = [...parens, ...noteBits].filter(Boolean).join("; ") || null;
  if (!name) return null;
  return { name, category, notes };
}

const CAT_RANK = { billable: 0, new_hire: 1, contract: 2, resigned: 3 };

(function main() {
  const wb = XLSX.readFile(XLSX_PATH);
  if (!wb.Sheets[SHEET]) { console.error(`Sheet "${SHEET}" not found. Sheets: ${wb.SheetNames.join(", ")}`); process.exit(1); }
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: "", raw: false });
  const projColNames = aoa[0].slice(1).map(s => String(s).trim());

  // ---- resolve / create projects for each Excel column ----
  const findProjByName = db.prepare("SELECT id,name FROM projects WHERE name = ? COLLATE NOCASE");
  const projIdByCol = {};   // excel col name -> project id
  const projectsCreated = [];
  const ensureProject = (excelName) => {
    const target = PROJECT_ALIAS[excelName] || excelName;
    let p = findProjByName.get(target);
    if (p) return p.id;
    if (DRY) { projectsCreated.push(target + " (would create)"); return -1; }
    let slug = slugify(target), n = 1;
    while (db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug)) slug = slugify(target) + "-" + (++n);
    const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects").get().m;
    const id = db.prepare("INSERT INTO projects (slug,name,client,sort_order) VALUES (?,?,?,?)")
      .run(slug, target, "Adani", maxOrder + 1).lastInsertRowid;
    projectsCreated.push(target);
    return id;
  };
  projColNames.forEach((c, i) => { if (c) projIdByCol[i + 1] = ensureProject(c); });

  // ---- walk role rows and collect (project, person, role) assignments ----
  const assignments = []; // { colIdx, role, person }
  let currentRole = null, started = false;
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r];
    const label = String(row[0] || "").trim();
    if (label && label.toLowerCase() === "legends") break;       // stop at the legend block
    if (label) {                                                  // a role label
      if (KNOWN_ROLES.has(label.toLowerCase())) { currentRole = label; started = true; }
      else if (started) currentRole = label;                     // tolerate unlisted role labels
      else continue;                                             // pre-role description rows
    }
    if (!started || !currentRole) continue;
    for (let c = 1; c < row.length; c++) {
      const person = parsePerson(row[c]);
      if (person) assignments.push({ colIdx: c, role: currentRole, person });
    }
  }

  // ---- upsert resources (dedupe by name) + create links ----
  const findRes = db.prepare("SELECT id,category FROM resources WHERE name = ? COLLATE NOCASE");
  const resIdByName = {};
  let resourcesCreated = 0, linksCreated = 0, linksSkipped = 0;

  const apply = db.transaction(() => {
    for (const a of assignments) {
      const projId = projIdByCol[a.colIdx];
      if (!projId || projId === -1) continue;
      const key = a.person.name.toLowerCase();
      let resId = resIdByName[key];
      if (!resId) {
        const existing = findRes.get(a.person.name);
        if (existing) {
          resId = existing.id;
          // upgrade category if this cell carries a stronger signal (contract/resigned/new_hire)
          if (CAT_RANK[a.person.category] > CAT_RANK[existing.category || "billable"]) {
            db.prepare("UPDATE resources SET category = ? WHERE id = ?").run(a.person.category, resId);
          }
        } else {
          const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM resources").get().m;
          resId = db.prepare("INSERT INTO resources (name,role,category,notes,sort_order) VALUES (?,?,?,?,?)")
            .run(a.person.name, a.role, a.person.category, a.person.notes, maxOrder + 1).lastInsertRowid;
          resourcesCreated++;
        }
        resIdByName[key] = resId;
      }
      const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM project_resources WHERE project_id = ?").get(projId).m;
      const info = db.prepare("INSERT OR IGNORE INTO project_resources (project_id,resource_id,role,sort_order) VALUES (?,?,?,?)")
        .run(projId, resId, a.role, maxOrder + 1);
      if (info.changes) linksCreated++; else linksSkipped++;
    }
  });

  if (DRY) {
    console.log(`[DRY RUN] no writes.`);
    console.log(`Projects (alias→existing or create):`);
    projColNames.forEach((c, i) => { if (c) console.log(`   ${c}  →  ${PROJECT_ALIAS[c] || c}`); });
    console.log(`Would create projects: ${projectsCreated.join(", ") || "(none — all matched)"}`);
    console.log(`Parsed ${assignments.length} assignments across ${new Set(assignments.map(a=>a.person.name.toLowerCase())).size} distinct people.`);
    const sample = assignments.slice(0, 15).map(a => `   ${projColNames[a.colIdx-1]} · ${a.role} · ${a.person.name}${a.person.category!=='billable'?` [${a.person.category}]`:''}`);
    console.log("Sample:\n" + sample.join("\n"));
    process.exit(0);
  }

  apply();
  console.log(`✓ Import complete.`);
  console.log(`  Projects created: ${projectsCreated.length ? projectsCreated.join(", ") : "(none — all matched existing)"}`);
  console.log(`  Resources created: ${resourcesCreated}`);
  console.log(`  Links created: ${linksCreated}  |  already existed (skipped): ${linksSkipped}`);
  console.log(`  Total projects now: ${db.prepare("SELECT COUNT(*) n FROM projects").get().n}, resources: ${db.prepare("SELECT COUNT(*) n FROM resources").get().n}, links: ${db.prepare("SELECT COUNT(*) n FROM project_resources").get().n}`);
  process.exit(0);
})();
