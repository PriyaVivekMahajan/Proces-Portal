# Process Dashboard — Web App

Multi-user version of the Process Management Dashboard.
Same UI as the local HTML dashboard, but everyone sees the same live data.

**Stack:** Node.js + Express + SQLite (single file, no server to manage).

---

## What you get

- Same look as the HTML dashboard (sidebar + tabs + project view + 18-phase stage gates).
- Multi-user — everyone logs in with their own account.
- Live shared data — when someone updates a task, others see it (auto-refresh every 30 seconds).
- Audit log of every change (who did what, when).
- Approve-to-unlock workflow for project phases — phases can't skip ahead.
- One file holds the entire database (`data/process-dashboard.db`).

---

## Quick start (local — 5 minutes)

### 1. Install Node.js (one-time, only on your computer)

Download from [nodejs.org](https://nodejs.org) — pick the **LTS** version. Install with all defaults.

Verify in PowerShell or Command Prompt:
```
node --version
```
You should see something like `v20.x.x`.

### 2. Install the app's dependencies

Open PowerShell, navigate to this folder, and run:

```
cd "C:\Users\Priyanka Jadhav\OneDrive - Centre for Computational Technologies Private Limited\Documents\Claude\Projects\Process Management\process-dashboard-app"
npm install
```

This will take 30–60 seconds the first time. It downloads the libraries the app needs.

### 3. Create your `.env` file

Copy `.env.example` to `.env` (rename it). The defaults work fine.

### 4. Initialize the database + create your admin user

```
npm run init
```

You'll be asked for your email, name, and a password. Pick anything — this is the admin account for the app.

### 5. Start the app

```
npm start
```

You'll see:
```
✓ Server running at http://localhost:3000
```

Open that URL in your browser, log in with the credentials you just made, and you'll see the same dashboard as the HTML one — but now backed by the database.

---

## Adding teammates

Send them the URL `http://YOUR-COMPUTER-IP:3000` (only works if they're on the same network as your computer).

On the login page they click **Sign up**, create their own account, and start using it. Everyone sees the same data.

To find your computer's IP on the local network:
```
ipconfig
```
Look for **IPv4 Address** (e.g. `192.168.1.42`). Your teammates open `http://192.168.1.42:3000`.

> **Note:** This only works while your computer is on. For 24/7 access from anywhere, deploy to the cloud (see `DEPLOY.md`).

---

## Daily use

Once running, just `npm start` whenever you want to use it.

To stop the app, press `Ctrl+C` in the terminal where it's running.

The database lives at `data/process-dashboard.db` — back it up by copying that file.

---

## Project structure

```
process-dashboard-app/
├── server.js           # Express app + REST API
├── db.js               # SQLite connection
├── schema.js           # Database tables definition
├── seed.js             # Initial data (same as HTML dashboard)
├── migrate.js          # First-time setup (run via npm run init)
├── package.json        # Dependencies
├── .env.example        # Copy to .env
├── public/
│   ├── index.html      # Main dashboard UI (same as HTML one)
│   ├── app.js          # Frontend logic, calls the API
│   └── login.html      # Login / signup page
└── data/
    └── process-dashboard.db    # Created on first run — your data
```

---

## Troubleshooting

**"npm: command not found"** — Node.js isn't installed. Install from nodejs.org.

**"Error: Cannot find module 'better-sqlite3'"** — You skipped `npm install`. Run it now.

**"Database is locked"** — Two `npm start` instances running. Stop one with Ctrl+C.

**Port 3000 in use** — Change `PORT=3000` in `.env` to `PORT=3001`.

**Reset the database** — Delete `data/process-dashboard.db` and re-run `npm run init`.

---

## What's next

Once it's working locally, the next step is deploying it to the cloud so teammates can access it 24/7 from anywhere. See `DEPLOY.md`.
