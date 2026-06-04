// Throwaway integration test for the Team / user-management endpoints.
// Spins the real Express app against a temp DB, then exercises the API over HTTP.
const path = require("path");
const fs = require("fs");
const os = require("os");

const TMP = path.join(os.tmpdir(), "pd-team-test-" + process.pid + ".db");
process.env.DB_PATH = TMP;
process.env.PORT = "3099";
process.env.JWT_SECRET = "test-secret";

// 1) Build the base schema + a known admin BEFORE the server opens the DB.
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const { SCHEMA_SQL } = require("./schema");
(function setup() {
  const db = new Database(TMP);
  db.exec(SCHEMA_SQL);
  const hash = bcrypt.hashSync("admin123", 10);
  db.prepare("INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)")
    .run("admin@test.com", hash, "Admin One", "admin");
  db.close();
})();

const BASE = "http://localhost:3099";
let cookie = "";
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗ FAIL:", msg); } }

async function req(method, p, body, useCookie = true) {
  const headers = { "Content-Type": "application/json" };
  if (useCookie && cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setC = r.headers.get("set-cookie");
  if (setC) cookie = setC.split(";")[0];
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

async function run() {
  console.log("Auth + guards:");
  let r = await req("GET", "/api/users", null, false);
  ok(r.status === 401, "GET /api/users without auth → 401");

  r = await req("POST", "/api/auth/login", { email: "admin@test.com", password: "admin123" });
  ok(r.status === 200 && r.data.user.role === "admin", "login as admin");

  console.log("List:");
  r = await req("GET", "/api/users");
  ok(r.status === 200 && Array.isArray(r.data) && r.data.length === 1, "GET /api/users returns 1 user");
  ok("created_at" in r.data[0], "user rows include created_at");
  const adminId = r.data[0].id;

  console.log("Create:");
  r = await req("POST", "/api/users", { name: "Bob Member", email: "BOB@test.com", password: "secret1", role: "member" });
  ok(r.status === 200 && r.data.email === "bob@test.com" && r.data.role === "member", "create member (email lowercased)");
  const bobId = r.data.id;

  r = await req("POST", "/api/users", { name: "Dup", email: "bob@test.com", password: "secret1" });
  ok(r.status === 409, "duplicate email → 409");

  r = await req("POST", "/api/users", { name: "Short", email: "x@test.com", password: "123" });
  ok(r.status === 400, "short password → 400");

  // new member can log in
  const savedCookie = cookie; cookie = "";
  r = await req("POST", "/api/auth/login", { email: "bob@test.com", password: "secret1" });
  ok(r.status === 200, "new member can log in");
  // member is blocked from admin actions
  r = await req("POST", "/api/users", { name: "Nope", email: "n@test.com", password: "secret1" });
  ok(r.status === 403, "member creating a user → 403 (admin only)");
  cookie = savedCookie; // back to admin

  console.log("Change role:");
  r = await req("PATCH", "/api/users/" + bobId, { role: "admin" });
  ok(r.status === 200, "promote Bob to admin");
  r = await req("GET", "/api/users");
  ok(r.data.find(u => u.id === bobId).role === "admin", "Bob is now admin");

  r = await req("PATCH", "/api/users/" + bobId, { role: "member" });
  ok(r.status === 200, "demote Bob back to member (another admin exists)");

  console.log("Guards:");
  r = await req("DELETE", "/api/users/" + adminId);
  ok(r.status === 409 && /your own account/i.test(r.data.error), "admin cannot delete self");

  r = await req("PATCH", "/api/users/" + adminId, { role: "member" });
  ok(r.status === 409 && /last admin/i.test(r.data.error), "cannot demote the last admin");

  console.log("Delete:");
  r = await req("DELETE", "/api/users/" + bobId);
  ok(r.status === 200, "delete Bob");
  r = await req("GET", "/api/users");
  ok(r.data.length === 1, "back to 1 user");

  r = await req("DELETE", "/api/users/99999");
  ok(r.status === 404, "delete missing user → 404");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// Start the server, then run the suite.
require("./server");
setTimeout(run, 800);
