// ============================================================
// One-time setup: create the database, apply schema, seed data,
// and create an admin user.
//
// Run:  npm run init
// ============================================================
const db = require("./db");
const bcrypt = require("bcrypt");
const readline = require("readline");
const { SCHEMA_SQL } = require("./schema");
const { seedDatabase } = require("./seed");

function ask(question, opts = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

(async () => {
  console.log("📦 Applying schema...");
  db.exec(SCHEMA_SQL);
  console.log("✓ Schema applied.");

  console.log("\n🌱 Seeding data...");
  seedDatabase(db);

  const userCount = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (userCount === 0) {
    console.log("\n👤 Create your first admin user:");
    const email = await ask("   Email: ");
    const name = await ask("   Name: ");
    const password = await ask("   Password (will be stored hashed): ");
    if (!email || !name || !password) { console.log("❌ Missing fields. Aborting."); process.exit(1); }
    const hash = await bcrypt.hash(password, 10);
    db.prepare("INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)").run(email, hash, name, "admin");
    console.log("✓ Admin user created.");
  } else {
    console.log(`⏭  Users already exist (${userCount}). Skipping admin creation.`);
  }

  console.log("\n🎉 All done! Start the server with:  npm start");
  process.exit(0);
})();
