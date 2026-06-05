// ============================================================
// Importer: merge "Adani Latest RM Data.xlsx" (one row per employee)
// into resources + project_resources.
//   - MERGE: update existing people by name, add new ones, keep the rest.
//   - Fills the rich columns (designation, employee_type, deployment_status,
//     experience, tech tracks, employee_id) and derives category.
//
// Run:  node import-rm.js            (writes to the live DB)
//       node import-rm.js --dry      (parse + report only)
// ============================================================
const path = require("path");
const XLSX = require("xlsx");
const db = require("./db");

const DRY = process.argv.includes("--dry");
const XLSX_PATH = path.join(__dirname, "data", "Adani Latest RM Data.xlsx");

// File "Project A"  ->  existing DB project name. Unlisted (non-blank) ones get created
// using the name with the "AGEL - " prefix stripped.
const PROJECT_ALIAS = {
  "AGEL - DRS": "DRS",
  "AGEL - Pulse": "Pulse",
  "AGEL - Precommissioning HOTO": "Pre-Com HOTO",
  "AGEL - Gati Shakti Plot addition": "Gatishakti",
  "AGEL - Civil Automation": "Adani Engg Automation",
  "CSTech": "CSTech",
};

function slugify(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || ("project-" + Date.now());
}

function deriveCategory(employeeType, deploymentStatus, designation) {
  const t = String(employeeType || "").toLowerCase();
  const s = String(deploymentStatus || "").toLowerCase();
  const d = String(designation || "").toLowerCase();
  if (t.includes("contract") || d.includes("contract")) return "contract";
  if (t.includes("intern") || s.includes("intern") || d.includes("intern")) return "new_hire";
  if (s === "deployed") return "billable";
  if (s.includes("unbilled") || s.includes("coe") || s === "management" || s === "sales" || s === "support") return "unbillable";
  return "billable";
}

(function main() {
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });

  // ---- project resolver ----
  const findProjByName = db.prepare("SELECT id FROM projects WHERE name = ? COLLATE NOCASE");
  const projCache = {}; const projectsCreated = [];
  function ensureProject(fileName) {
    const raw = String(fileName || "").trim();
    if (!raw) return null;
    if (projCache[raw] !== undefined) return projCache[raw];
    const target = PROJECT_ALIAS[raw] || raw.replace(/^AGEL\s*-\s*/i, "").trim();
    let p = findProjByName.get(target);
    let id;
    if (p) id = p.id;
    else if (DRY) { id = -1; projectsCreated.push(target + " (would create)"); }
    else {
      let slug = slugify(target), n = 1;
      while (db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug)) slug = slugify(target) + "-" + (++n);
      const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM projects").get().m;
      id = db.prepare("INSERT INTO projects (slug,name,client,sort_order) VALUES (?,?,?,?)").run(slug, target, "Adani", maxOrder + 1).lastInsertRowid;
      projectsCreated.push(target);
    }
    projCache[raw] = id;
    return id;
  }

  const findRes = db.prepare("SELECT id FROM resources WHERE name = ? COLLATE NOCASE");
  let created = 0, updated = 0, linksCreated = 0, linksSkipped = 0, noProject = 0;
  const parsed = [];

  const apply = db.transaction(() => {
    for (const row of rows) {
      const name = `${String(row["First Name"] || "").trim()} ${String(row["Last Name"] || "").trim()}`.trim();
      if (!name) continue;
      const designation = String(row["Designation"] || "").trim() || null;
      const employeeType = String(row["Employee type"] || "").trim() || null;
      const deploymentStatus = String(row["Deployment Status"] || "").trim() || null;
      const category = deriveCategory(employeeType, deploymentStatus, designation);
      const attrs = {
        role: designation,
        category,
        employee_id: String(row["EmployeeID"] || "").trim() || null,
        designation,
        employee_type: employeeType,
        deployment_status: deploymentStatus,
        experience: String(row["Experience"] || "").trim() || null,
        total_experience: String(row["Total Experience"] || "").trim() || null,
        primary_tech: String(row["Primary Technology Track"] || "").trim() || null,
        secondary_tech: String(row["Secondary Technology Tracks"] || "").trim() || null,
      };
      const projFile = String(row["Project A"] || "").trim();
      parsed.push({ name, category, designation, project: projFile });
      if (DRY) { if (projFile) ensureProject(projFile); else noProject++; continue; }

      const existing = findRes.get(name);
      let resId;
      if (existing) {
        resId = existing.id;
        const sets = Object.keys(attrs).map(k => `${k} = ?`).join(", ");
        db.prepare(`UPDATE resources SET ${sets} WHERE id = ?`).run(...Object.values(attrs), resId);
        updated++;
      } else {
        const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM resources").get().m;
        const cols = ["name", ...Object.keys(attrs), "sort_order"];
        const vals = [name, ...Object.values(attrs), maxOrder + 1];
        db.prepare(`INSERT INTO resources (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
        resId = db.prepare("SELECT id FROM resources WHERE name = ? COLLATE NOCASE").get(name).id;
        created++;
      }

      if (projFile) {
        const projId = ensureProject(projFile);
        if (projId && projId !== -1) {
          const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM project_resources WHERE project_id = ?").get(projId).m;
          const info = db.prepare("INSERT OR IGNORE INTO project_resources (project_id,resource_id,role,sort_order) VALUES (?,?,?,?)")
            .run(projId, resId, designation, maxOrder + 1);
          if (info.changes) linksCreated++; else linksSkipped++;
        }
      } else noProject++;
    }
  });

  if (DRY) {
    // run parse loop once (no transaction) to populate parsed/projectsCreated
    for (const row of rows) {
      const name = `${String(row["First Name"] || "").trim()} ${String(row["Last Name"] || "").trim()}`.trim();
      const projFile = String(row["Project A"] || "").trim();
      if (projFile) ensureProject(projFile); else noProject++;
    }
    console.log("[DRY RUN] no writes.");
    console.log("Employees in file:", rows.length);
    console.log("New projects to create:", projectsCreated.length ? projectsCreated.join(", ") : "(none)");
    console.log("People with no project (Resources only):", noProject);
    const catCount = {}; parsed.forEach(p => catCount[p.category] = (catCount[p.category] || 0) + 1);
    console.log("Category breakdown:", JSON.stringify(catCount));
    console.log("Sample:", parsed.slice(0, 8).map(p => `${p.name} · ${p.designation} · ${p.category} · ${p.project || "—"}`).join("\n         "));
    process.exit(0);
  }

  apply();
  console.log("✓ RM merge complete.");
  console.log(`  Resources: ${created} created, ${updated} updated`);
  console.log(`  New projects created: ${projectsCreated.length ? projectsCreated.join(", ") : "(none)"}`);
  console.log(`  Project links: ${linksCreated} created, ${linksSkipped} already existed`);
  console.log(`  People with no project: ${noProject}`);
  console.log(`  Totals now → projects: ${db.prepare("SELECT COUNT(*) n FROM projects").get().n}, resources: ${db.prepare("SELECT COUNT(*) n FROM resources").get().n}, links: ${db.prepare("SELECT COUNT(*) n FROM project_resources").get().n}`);
  process.exit(0);
})();
