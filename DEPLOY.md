# Deployment Guide

Once the app runs locally (see README.md), you can put it on the internet so your team can access it from anywhere.

## Recommended: Render.com (free tier, easy)

[Render](https://render.com) hosts the app + persistent disk for SQLite, free tier covers a small team.

### Steps

1. **Push the code to GitHub:**
   - Create a free GitHub account if you don't have one.
   - Create a new private repository.
   - Upload this `process-dashboard-app/` folder to it.
   - **Do NOT commit the `.env` file or `data/` folder** — they're already in `.gitignore`.

2. **Sign up at [render.com](https://render.com)** with your GitHub account.

3. **Create a new Web Service:**
   - Click "New" → "Web Service".
   - Connect your GitHub repo.
   - Settings:
     - Build Command: `npm install`
     - Start Command: `npm run init && npm start` *(only on first deploy; change to `npm start` after)*
     - Environment: Node
     - Plan: Free
   - Add environment variables:
     - `JWT_SECRET` — paste a long random string
     - `DB_PATH` — `/var/data/process-dashboard.db`
     - `NODE_ENV` — `production`

4. **Add a persistent disk:**
   - In the Render dashboard, go to your service → "Disks" → Add Disk.
   - Mount path: `/var/data`
   - Size: 1 GB (more than enough)

5. **Deploy.** Render gives you a URL like `https://process-dashboard.onrender.com`. Share it with your team.

> **Note on the free tier:** Render's free tier spins down after 15 min of inactivity. The first request after sleep takes ~30 seconds to wake up. Upgrade to a paid plan ($7/month) for always-on.

---

## Alternative: Run on a Windows server in your office

If you have a server or always-on PC in the office:

1. Install Node.js on it.
2. Copy the `process-dashboard-app/` folder there.
3. `npm install`, `npm run init`, then `npm start`.
4. Open Windows Firewall for port 3000.
5. Team accesses `http://server-ip:3000`.

For automatic restart, use [PM2](https://pm2.keymetrics.io):
```
npm install -g pm2
pm2 start server.js --name process-dashboard
pm2 save
pm2 startup
```

---

## Alternative: Azure App Service

If your company already uses Azure (you have Azure DevOps for AGEL), this fits naturally:

1. Create an App Service (Linux, Node 20).
2. Configure GitHub deployment.
3. Add an **Azure Files** mount for `/home/data` (persistent storage for the SQLite file).
4. Environment variables (same as Render above).

Detailed Azure App Service deploy instructions: [Azure docs](https://learn.microsoft.com/azure/app-service/quickstart-nodejs).

---

## After deployment

- **Back up the database regularly** — it's just one file (`process-dashboard.db`). On Render, use their disk backup feature or schedule a copy via cron.
- **Rotate the JWT secret** if you suspect it's leaked — set a new `JWT_SECRET` env var and redeploy (everyone will need to log in again).
- **Add HTTPS** — Render gives you HTTPS automatically. For self-hosting, use [Caddy](https://caddyserver.com) or nginx + Let's Encrypt.

---

## Backup script (local)

A simple script to copy the database file daily:

```bat
@echo off
set TIMESTAMP=%date:~10,4%-%date:~4,2%-%date:~7,2%
copy "data\process-dashboard.db" "backups\process-dashboard-%TIMESTAMP%.db"
```

Save as `backup.bat` in the app folder, schedule via Windows Task Scheduler.
