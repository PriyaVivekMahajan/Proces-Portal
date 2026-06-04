# Process Dashboard — Developer Documentation

A multi-user web application for tracking organizational processes and project plans with stage-gated 18-phase workflow (PDOM).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Database](#4-database)
5. [Authentication](#5-authentication)
6. [REST API Reference](#6-rest-api-reference)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Project Structure](#8-project-structure)
9. [Development Workflow](#9-development-workflow)
10. [Deployment](#10-deployment)
11. [Security Notes](#11-security-notes)
12. [Future Roadmap](#12-future-roadmap)

---

## 1. Overview

### Purpose

A shared, multi-user dashboard for the Adani BU team to track:
- Six organizational processes (AI Initiative, QA, Scrum of Scrums, PM Process, Demo Videos, Training & Mentorship), each with editable tasks, sub-action items, owners, due dates, statuses, and notes.
- Five active projects (DRS, Pulse, Pre-Com HOTO, Gatishakti, Cement), each with an 18-phase stage-gated project plan derived from the Project Delivery Operating Model (PDOM).
- Stage-gate approval workflow — phases unlock sequentially only after their prerequisites are met and a named approver explicitly clicks Approve.

### Why this exists

The original dashboard was a static HTML file that stored data in browser localStorage, meaning each user had a private copy. This web app moves the data to a real database so multiple users see the same live state.

### Design principles

- **Same UI as the local HTML dashboard** — minimal learning curve for users who've already used it.
- **Simple deployment** — file-based SQLite, no separate database server, no Docker required.
- **Live multi-user** — auto-refresh every 30 seconds. Edits become visible to everyone.
- **Audit-friendly** — every mutation is logged with user, action, entity, timestamp.

---

## 2. Tech Stack

### Backend

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Runtime | **Node.js** | ≥18 LTS | JavaScript runtime |
| Web framework | **Express** | 4.19.x | HTTP server + routing + middleware |
| Database driver | **better-sqlite3** | 11.1.x | Synchronous SQLite client — fastest available for Node |
| Authentication | **bcrypt** | 5.1.x | Password hashing (10 rounds) |
| Session tokens | **jsonwebtoken** | 9.0.x | JWT for login cookies |
| Cookie parsing | **cookie-parser** | 1.4.x | Parse HTTP cookies |
| Config | **dotenv** | 16.4.x | Load environment variables from `.env` |

### Database

**SQLite 3** (embedded, file-based)

- Single file on disk: `data/process-dashboard.db`
- Foreign key constraints enforced
- WAL (Write-Ahead Logging) mode enabled for better concurrent read performance
- No separate database server process
- ACID-compliant
- Capable of handling reasonable concurrent load for a small team (10–50 users)

### Frontend

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Markup | **HTML5** | Static page structure |
| Styles | **Vanilla CSS** | All styles inline in `index.html` |
| Logic | **Vanilla JavaScript (ES6+)** | No framework. Single `app.js` file with imperative DOM rendering |
| API | **Fetch API + JSON** | All client-server calls via `fetch()` with credentials |
| State | **In-memory + localStorage** | Current view stored in localStorage; data refreshed from server every 30 s |

### Why no React / Vue / framework?

The UI is small enough that vanilla JS keeps the bundle at zero. No build step, no `node_modules` bloat on the client side, no transpilation. The entire frontend is two files (`index.html` + `app.js`) that load instantly.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────┐
│                  Browser                         │
│  ┌────────────────────────────────────────────┐ │
│  │ public/index.html (UI + CSS)               │ │
│  │ public/app.js (fetch calls, DOM rendering) │ │
│  └─────────────┬──────────────────────────────┘ │
└────────────────┼─────────────────────────────────┘
                 │ HTTPS (cookies for auth)
                 │ JSON over REST
                 ▼
┌─────────────────────────────────────────────────┐
│             Node.js + Express                    │
│  ┌────────────────────────────────────────────┐ │
│  │ server.js                                  │ │
│  │  ├── /api/auth/*       (login, signup)     │ │
│  │  ├── /api/processes    (read processes)    │ │
│  │  ├── /api/tasks/*      (CRUD tasks)        │ │
│  │  ├── /api/subitems/*   (CRUD sub-items)    │ │
│  │  ├── /api/projects/*   (CRUD projects)     │ │
│  │  └── /api/phases/*     (approve, prereqs)  │ │
│  └─────────────┬──────────────────────────────┘ │
│                │                                 │
│  ┌─────────────▼──────────────────────────────┐ │
│  │ db.js  ← better-sqlite3                    │ │
│  └─────────────┬──────────────────────────────┘ │
└────────────────┼─────────────────────────────────┘
                 │
                 ▼
         ┌───────────────────┐
         │ process-          │
         │ dashboard.db      │  (SQLite file)
         │ data/...          │
         └───────────────────┘
```

### Request lifecycle

1. Browser loads `/` → server returns `public/index.html`.
2. `index.html` loads `app.js`, which immediately calls `GET /api/auth/me`.
3. If 401 → redirect to `/login.html`. Otherwise the user is authenticated.
4. `app.js` fetches `/api/processes` and `/api/projects` in parallel.
5. UI renders. A `setInterval` polls these endpoints every 30 seconds to pick up edits from other users.
6. All user actions (edit task, approve phase, etc.) become a `PATCH`/`POST`/`DELETE` call. On success, the frontend re-fetches and re-renders.

---

## 4. Database

### Connection

`db.js` opens the SQLite file with:
- `journal_mode = WAL` — readers don't block writers
- `foreign_keys = ON` — enforces FK constraints
- `synchronous = NORMAL` — balanced durability/performance

The connection is a singleton — one `Database` instance shared across all requests (better-sqlite3 is synchronous, so this is fine).

### Schema

Defined in `schema.js` and applied via `migrate.js`.

#### `users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | Auto-increment |
| `email` | TEXT UNIQUE | Lowercased on insert |
| `password_hash` | TEXT | bcrypt hash |
| `name` | TEXT | Display name |
| `role` | TEXT | `admin` / `member` / `viewer` (RBAC not yet enforced) |
| `created_at` | TEXT | ISO timestamp |

#### `processes`
Top-level workstream categories (AI Initiative, QA Process, etc.).
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `slug` | TEXT UNIQUE | URL-safe identifier |
| `title`, `subtitle`, `icon`, `meta`, `description` | TEXT | Display metadata |
| `sort_order` | INTEGER | Used to control sidebar order |

#### `process_tasks`
Individual to-do items inside a process.
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `process_id` | INTEGER FK → processes(id) | CASCADE delete |
| `title`, `owner`, `notes` | TEXT | |
| `due_date` | TEXT | ISO date `YYYY-MM-DD` |
| `status` | TEXT | `not_started` / `in_progress` / `completed` / `blocked` |
| `sort_order` | INTEGER | |
| `created_at`, `updated_at` | TEXT | ISO timestamps (auto via DEFAULT and PATCH endpoints) |
| `updated_by` | INTEGER FK → users(id) | Records who last touched it |

#### `task_subitems`
Checklist items nested inside a task.
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `task_id` | INTEGER FK → process_tasks(id) | CASCADE delete |
| `text` | TEXT | |
| `done` | INTEGER | 0 / 1 (SQLite has no native boolean) |
| `sort_order` | INTEGER | |

#### `projects`
Active projects (DRS, Pulse, etc.).
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `slug` | TEXT UNIQUE | |
| `name`, `client`, `pm`, `tech_lead`, `ba`, `qa_lead`, `sa` | TEXT | Team & ownership |
| `start_date`, `go_live_date` | TEXT | ISO dates |
| `notes` | TEXT | |
| `rag_scope`, `rag_timeline`, `rag_budget`, `rag_resources`, `rag_quality` | TEXT | Each one of `green` / `amber` / `red` |
| `sort_order` | INTEGER | |
| `created_at`, `updated_at` | TEXT | |

#### `project_phases`
Stage-gated phases per project. Each project has 18 rows (one per PDOM phase).
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `project_id` | INTEGER FK → projects(id) | CASCADE delete |
| `phase_num` | INTEGER | 1–18 |
| `name`, `owner`, `approver` | TEXT | |
| `status` | TEXT | `locked` / `in_progress` / `completed` |
| `notes` | TEXT | |
| `approved_at` | TEXT | Set when phase is approved |
| `approved_by` | INTEGER FK → users(id) | Who clicked the Approve button |
| UNIQUE | (`project_id`, `phase_num`) | One row per phase per project |

#### `phase_prerequisites`
Checklist of conditions per phase. Phase can't be approved until all are `done=1`.
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `phase_id` | INTEGER FK → project_phases(id) | CASCADE delete |
| `text` | TEXT | |
| `done` | INTEGER | 0 / 1 |
| `sort_order` | INTEGER | |

#### `audit_log`
Append-only log of all mutations. Read-only via API.
| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK | |
| `user_id`, `user_email` | INTEGER / TEXT | Who did it |
| `action` | TEXT | `create` / `update` / `delete` / `approve` / `login` / `signup` |
| `entity_type` | TEXT | `process_task` / `project` / `project_phase` / `user` / ... |
| `entity_id` | INTEGER | |
| `summary` | TEXT | Human-readable description |
| `payload` | TEXT (JSON) | Optional structured before/after |
| `created_at` | TEXT | ISO timestamp |

Index: `(entity_type, entity_id)` for fast lookup of "history for this object", plus `created_at DESC` for the latest-activity feed.

### Relationships (ASCII ERD)

```
users 1 ──── ∞ process_tasks (updated_by)
users 1 ──── ∞ project_phases (approved_by)
users 1 ──── ∞ audit_log (user_id)

processes 1 ──── ∞ process_tasks ──── ∞ task_subitems
projects  1 ──── ∞ project_phases ──── ∞ phase_prerequisites
```

### Seed data

`seed.js` exports two arrays — `PROCESSES` and `PROJECTS` — with the same content as the local HTML dashboard. Run via `npm run init`. The script checks if `processes` already has rows; if so, it skips re-seeding (idempotent).

### Backups

The whole database is the single file `data/process-dashboard.db`. Backup = copy the file. See `DEPLOY.md` for a sample `.bat` script.

---

## 5. Authentication

### Mechanism

- **Email + password** with bcrypt-hashed passwords (10 rounds).
- On successful login/signup, server issues a JWT signed with `JWT_SECRET` (HMAC-SHA256, expiration default 7 days).
- JWT is stored in an **HttpOnly cookie** named `token` (sameSite=lax). Not accessible to JavaScript, mitigating XSS-driven token theft.
- All `/api/*` endpoints except `/api/auth/login` and `/api/auth/signup` require the cookie.

### Middleware: `requireAuth`

```javascript
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
```

The middleware refetches the user from the database on every request — so deleted users immediately lose access.

### Frontend behavior

- On page load, `app.js` calls `GET /api/auth/me`. If it returns 401, the user is redirected to `/login.html`.
- All API helpers funnel through a shared `api()` function that intercepts 401 and triggers redirect.

### Roles (RBAC)

Three roles exist in the schema (`admin` / `member` / `viewer`) but role checks are **not yet enforced** at endpoint level. All authenticated users can edit everything. Adding role gates is a small change — see [Future Roadmap](#12-future-roadmap).

---

## 6. REST API Reference

All endpoints return JSON. All non-auth endpoints require the `token` cookie. Errors return `{ "error": "message" }` with appropriate HTTP status.

### Auth

#### `POST /api/auth/signup`
Create a new user.

**Body:**
```json
{ "email": "user@cctech.co.in", "name": "Vijay", "password": "min6chars" }
```

**Response:**
```json
{ "user": { "id": 2, "email": "user@cctech.co.in", "name": "Vijay", "role": "member" } }
```
Sets `token` cookie. Returns 409 if email already registered.

#### `POST /api/auth/login`
**Body:** `{ "email": "...", "password": "..." }`
**Response:** Same as signup. Sets `token` cookie. Returns 401 on bad credentials.

#### `POST /api/auth/logout`
Clears the `token` cookie. Returns `{ "ok": true }`.

#### `GET /api/auth/me`
Returns `{ "user": {...} }` if authenticated, 401 otherwise.

### Processes

#### `GET /api/processes`
Returns an array of all processes, each with nested tasks and sub-items.

**Response shape:**
```json
[
  {
    "id": 1, "slug": "ai-initiative", "title": "AI Initiative", "subtitle": "...",
    "icon": "🤖", "meta": "...", "description": "...",
    "tasks": [
      {
        "id": 4, "process_id": 1, "title": "Create Azure repo", "owner": "Priyanka Jadhav",
        "due_date": "2025-05-15", "status": "completed", "notes": "...",
        "subitems": [
          { "id": 12, "text": "Repo created", "done": true }
        ]
      }
    ]
  }
]
```

### Tasks

#### `POST /api/processes/:id/tasks`
Create a task in a process. Body: `{ "title": "...optional..." }`. Returns `{ "id": <newId> }`.

#### `PATCH /api/tasks/:id`
Partial update. Any subset of: `title`, `owner`, `due_date`, `status`, `notes`. Uses `COALESCE` so unsent fields are unchanged.

#### `DELETE /api/tasks/:id`
Hard delete. Cascades to `task_subitems`.

### Sub-items

#### `POST /api/tasks/:id/subitems`
Body: `{ "text": "..." }`. Returns `{ "id": <newId> }`.

#### `PATCH /api/subitems/:id`
Body: `{ "text": "...", "done": true|false }` (either or both).

#### `DELETE /api/subitems/:id`
Hard delete.

### Projects

#### `GET /api/projects`
Returns all projects with nested phases and per-phase prerequisites.

```json
[
  {
    "id": 1, "slug": "drs", "name": "DRS", "client": "AGEL", "pm": "Rathin Pandya",
    "tech_lead": "Mahendra Dambe", "ba": "TBD", "qa_lead": "Vijay", "sa": "TBD",
    "start_date": "2025-04-01", "go_live_date": null, "notes": "...",
    "rag_scope": "green", "rag_timeline": "amber", "rag_budget": "green",
    "rag_resources": "amber", "rag_quality": "green",
    "phases": [
      {
        "id": 1, "project_id": 1, "phase_num": 1, "name": "Create Epic",
        "owner": "Product Owner", "approver": "Product Owner", "status": "completed",
        "approved_at": "2025-04-10 10:23:00", "approved_by": 1,
        "prerequisites": [
          { "id": 1, "text": "Azure access verified", "done": true }
        ]
      }
    ]
  }
]
```

#### `PATCH /api/projects/:id`
Partial update of any of: `name`, `client`, `pm`, `tech_lead`, `ba`, `qa_lead`, `sa`, `start_date`, `go_live_date`, `notes`, `rag_*`.

### Phases (stage-gate)

#### `PATCH /api/phases/:phaseId/prerequisites/:prereqId`
Tick or untick a prerequisite. Body: `{ "done": true|false }`. **Returns 409** if the phase is not currently `in_progress` (you can't edit completed or locked phases).

#### `POST /api/phases/:id/approve`
Approve the current phase. Server-side validations:
- Phase must be `in_progress` (else 409)
- All prerequisites must be `done=1` (else 400 with count of unmet)

On success, in a single SQL transaction:
1. Phase's `status` → `completed`, `approved_at` = now, `approved_by` = current user.
2. Next phase (`phase_num + 1`, if it exists) `status` → `in_progress`.

### Audit log

#### `GET /api/audit`
Latest 100 entries, newest first.
```json
[
  { "id": 102, "user_email": "priyanka@...", "action": "approve",
    "entity_type": "project_phase", "entity_id": 18,
    "summary": "Approved phase \"BRD & Artifacts\" (#3)",
    "created_at": "2026-05-26 14:32:11" }
]
```

---

## 7. Frontend Architecture

### Files

- **`public/index.html`** — Layout shell with sidebar, topbar, tiles, content area, modal. All CSS inline.
- **`public/app.js`** — All runtime logic. ~300 lines.
- **`public/login.html`** — Standalone login/signup page.

### State management

Two top-level globals refreshed every 30 seconds:
- `processes` — array of processes (with nested tasks + sub-items)
- `projects` — array of projects (with nested phases + prerequisites)

Plus:
- `currentView` — string like `"process:ai-initiative"`, `"projects-all"`, `"project:drs"`. Persisted in localStorage.
- `currentTaskEditing` — id of the task being edited in the modal, or `null`.
- `expandedPhases` — Set of phase keys currently expanded in the timeline.

### Rendering

Imperative — `renderAll()` calls `renderSidebar()`, `renderTiles()`, `renderTopbar()`, `renderContent()`, each of which sets `innerHTML` on the appropriate root element. No virtual DOM, no diffing — re-render is full-replace per section.

Every mutation triggers `await refreshData()` which:
1. Fetches both `/api/processes` and `/api/projects` in parallel
2. Updates the global arrays
3. Calls `renderAll()`

### Polling

A `setInterval(refreshData, 30000)` keeps the UI in sync with other users' edits. 30 seconds was chosen as a balance between responsiveness and server load — for small teams, this is fine. For larger teams, swap to WebSockets or Server-Sent Events.

### Why no client-side framework?

- Total app is ~300 lines of JS. A framework would be more code.
- No build step → users can read the code, instant deploy.
- Performance is fine for a few hundred tasks.

---

## 8. Project Structure

```
process-dashboard-app/
├── README.md               # User-facing setup guide
├── DEPLOY.md               # Cloud deployment instructions
├── DEV.md                  # This file
├── package.json            # Dependencies + scripts
├── .env.example            # Template config (copy to .env)
├── .gitignore              # node_modules, .env, data/ excluded
├── server.js               # Express app + all API routes (10 KB)
├── db.js                   # SQLite singleton connection (1 KB)
├── schema.js               # CREATE TABLE statements (4 KB)
├── seed.js                 # Initial data (17 KB)
├── migrate.js              # First-time setup CLI (2 KB)
├── public/
│   ├── index.html          # Dashboard UI + CSS (15 KB)
│   ├── app.js              # Frontend logic (12 KB)
│   └── login.html          # Login page (3 KB)
└── data/                   # Created on first run (gitignored)
    └── process-dashboard.db
```

---

## 9. Development Workflow

### Local setup

```bash
git clone <repo>
cd process-dashboard-app
cp .env.example .env       # Edit JWT_SECRET to something random
npm install
npm run init               # Applies schema, seeds data, prompts for admin credentials
npm start                  # Or: npm run dev (uses node --watch for hot reload)
```

Open `http://localhost:3000`.

### Useful commands

| Command | Purpose |
|---------|---------|
| `npm start` | Start the server normally |
| `npm run dev` | Start with `node --watch` — auto-restart on file change |
| `npm run init` | Apply schema + seed data + create admin user (skips already-seeded) |
| `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Generate a JWT secret |

### Adding a new process

1. In `seed.js`, append to the `PROCESSES` array.
2. Delete `data/process-dashboard.db` (you'll lose existing data).
3. `npm run init`.

Or insert at runtime via direct SQL — no API endpoint for creating processes exists yet (intentional — processes are meant to be schema-defined).

### Adding a new project

Currently via seed (delete db, re-run init) or direct SQL. To add a real "Create Project" API endpoint, see [Future Roadmap](#12-future-roadmap).

### Inspecting the database

Install [DB Browser for SQLite](https://sqlitebrowser.org) (free GUI), open `data/process-dashboard.db`. You'll see all tables and can run ad-hoc queries.

Or in the terminal:
```bash
npm install -g sqlite3
sqlite3 data/process-dashboard.db
sqlite> .tables
sqlite> SELECT * FROM users;
sqlite> SELECT name, status FROM project_phases WHERE project_id = 1;
```

### Resetting the database

```bash
rm data/process-dashboard.db
npm run init
```

### Testing

No automated tests yet (intentional — too small for now). A basic smoke test could be:

```bash
# Start server
npm start &
# Hit endpoints with curl
curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"yourpass"}'
curl -b cookies.txt http://localhost:3000/api/processes | jq '.[0].title'
```

For real test coverage, add **Jest** + **supertest**. See [Future Roadmap](#12-future-roadmap).

---

## 10. Deployment

See `DEPLOY.md` for step-by-step instructions for:

- **Render.com** (recommended, free tier) — managed Node hosting with persistent disk for SQLite
- **Self-hosted Windows server** with PM2 for process management
- **Azure App Service** with Azure Files mount

### Production environment variables

| Variable | Required | Example |
|----------|----------|---------|
| `PORT` | No (default 3000) | `8080` |
| `JWT_SECRET` | **Yes** | random 64-char hex string |
| `JWT_EXPIRES_IN` | No (default `7d`) | `30d` |
| `DB_PATH` | No (default `./data/process-dashboard.db`) | `/var/data/process-dashboard.db` |
| `NODE_ENV` | Recommended | `production` |

### Production checklist

- [ ] `JWT_SECRET` is a strong random string (not the default)
- [ ] `DB_PATH` points to a persistent volume (not ephemeral container storage)
- [ ] HTTPS enabled (Render does this automatically; for self-hosting use Caddy or Nginx)
- [ ] Set `Secure` flag on cookies for HTTPS-only (currently set to allow HTTP for local dev — change in `server.js` line setting cookies)
- [ ] Database backups configured (cron job copying the .db file)
- [ ] Monitor logs for repeated 401s (could indicate credential stuffing)

---

## 11. Security Notes

### Currently implemented

- Passwords hashed with bcrypt (10 rounds, ~100 ms per hash — slows brute-force)
- HttpOnly cookies — JS can't read the JWT
- SameSite=lax — CSRF mitigation for state-changing requests
- Parameterized SQL — prepared statements throughout, no string concatenation. Immune to SQL injection.
- Foreign key constraints enforced — orphan records prevented
- User lookup on every request — deleted users instantly lose access

### Not yet implemented (production caveats)

- **No rate limiting** on login. Add [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) before going public.
- **No CSRF token** beyond SameSite cookie — fine for same-origin, but if you add cross-origin clients, add a CSRF token.
- **No password reset flow** — admins must reset passwords via direct DB update for now.
- **No email verification** at signup.
- **No 2FA**.
- **No RBAC enforcement** at endpoint level — see Future Roadmap.
- **`Secure` flag not set on cookies** by default — fine for `localhost`, but set it to `true` in production HTTPS.

### Threat model

This app is designed for an internal team (≤50 users) on a trusted network or behind SSO. It is **not** designed for public internet exposure without additional hardening.

---

## 12. Future Roadmap

### Easy wins (1-2 hours each)

- **Role-based access control** — wrap mutating endpoints in `requireRole('admin')` middleware.
- **Live updates via Server-Sent Events** — replace 30-s polling with `EventSource`. Server emits "task-updated" / "phase-approved" events; clients re-fetch only when needed.
- **Process management API** — `POST /api/processes`, `DELETE /api/processes/:id` so admins can add/remove process categories without editing seed.js.
- **Audit log viewer** — UI page that displays the latest 100 entries from `/api/audit`. Useful for "who changed X?"
- **Better error messages** in the UI — currently `alert()`-based; replace with toast notifications.
- **Email magic-link login** — drop password requirement entirely. Use [nodemailer](https://nodemailer.com).
- **Password reset flow** — request token by email, confirm new password.
- **Search across all tasks and projects** — single global search box in the topbar.

### Medium effort (1-2 days)

- **Multi-tenant support** — add `organization_id` to all tables, scope all queries by tenant. Enables one deployment to serve multiple BUs.
- **File attachments** per task — store in S3 / Azure Blob, save URL in DB.
- **Comments thread** per task / phase — useful for context and decision history.
- **Mobile-friendly responsive overhaul** — current CSS works on mobile but is desktop-first.
- **Custom phase templates** — admin UI to define non-PDOM workflows (e.g., simpler 10-phase, or PMO standard SDLC).
- **Project import from Excel** — bulk import projects/phases from the existing `Project_Management_Tracker.xlsx` format.
- **Export to Excel / PDF** — generate per-project status reports.

### Larger initiatives

- **Real-time collaborative editing** — operational transforms or CRDTs for the notes field. Or simpler: optimistic UI with conflict detection.
- **Migration to PostgreSQL** — drop SQLite for horizontal scale. Adapter pattern would let both coexist.
- **Integration with Azure DevOps** — read/write work items in Azure Boards. Keep dashboard as the executive view, Azure as the source of truth for engineering tasks.
- **Microsoft Teams notifications** — webhook on phase approval, task overdue, etc.
- **Power BI / Looker integration** — read-only SQL view for analytics teams.
- **REST → GraphQL** — if the API surface grows, GraphQL avoids over-fetching.

### Migration paths

| If you need... | Move to... |
|---|---|
| More than ~100 concurrent users | PostgreSQL on Render / Supabase |
| Real-time collaboration | Add WebSockets via `ws` library |
| Mobile app | React Native talking to the same REST API |
| Enterprise SSO | Replace bcrypt + JWT with SAML / OIDC via [passport](https://www.passportjs.org) |
| Audit compliance | Add immutability constraints + retention policies on `audit_log` |

---

## Appendix A: Glossary

- **PDOM** — Project Delivery Operating Model. The 18-phase change flow documented in your `Project Delivery Operating Model (PDOM) V1.0.docx`.
- **CMF** — Change Management Form. Required document for phase 10 (CMF Walkthrough).
- **CAB** — Change Approval Board. Required for phase 16 (CAB Approval), chaired by Delivery Head.
- **SIT** — System Integration Testing. Phases 11–12.
- **UAT** — User Acceptance Testing. Phases 13–14, requires client.
- **RAG** — Red / Amber / Green status indicator for project health.
- **JWT** — JSON Web Token. Used for session authentication.
- **WAL** — Write-Ahead Logging. SQLite mode that allows concurrent reads while writes happen.

## Appendix B: External Links

- Node.js docs — https://nodejs.org/docs
- Express guide — https://expressjs.com/en/guide/routing.html
- better-sqlite3 API — https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- bcrypt docs — https://github.com/kelektiv/node.bcrypt.js
- JWT spec — https://datatracker.ietf.org/doc/html/rfc7519
- SQLite docs — https://www.sqlite.org/docs.html

---

**Last updated:** May 2026
**Maintainer:** Priyanka Jadhav
**License:** Internal — Centre for Computational Technologies
