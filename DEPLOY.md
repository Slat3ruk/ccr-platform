# Deployment Guide — CrossCurrent Racing Platform

**Target:** a self-hosted **VPS**, served as a **subdomain of the team website**
(e.g. `data.crosscurrentracing.com`).
**Auth:** the team website is the hub — it does Discord sign-in and sets a cookie
on the parent domain; this app (a subdomain) receives that cookie and just
**verifies** it. See the ⭐ release plan in `CLAUDE.md` for the full picture.

> **Status:** the production recipe below is the plan, not yet executed. Dev runs
> on a local JSON store (`.data/store.json`, one machine, not shared); production
> needs Postgres. The first real Postgres run is the one thing not yet smoke-
> tested end-to-end — the checklist here *is* that smoke test.

---

## What production needs

1. A **VPS** (Ubuntu 24.04 LTS, ~$5–10/mo) running the Next.js app as a persistent
   Node process.
2. **PostgreSQL** on the same box (real filesystem = durable writes; the JSON
   dev store's ephemeral limitation never applies here).
3. A **reverse proxy** ([Caddy](https://caddyserver.com) recommended) routing the
   subdomain to the app's local port, with automatic Let's Encrypt HTTPS.

---

## Server file layout

Everything CCR lives under **one parent tree**, each app cleanly separated:

```
/srv/ccr/
├── website/          # team website (the auth hub) — crosscurrentracing.com
├── data-platform/    # this app — data.crosscurrentracing.com   (:3000)
├── stint-planner/    # future web component                      (:3001)
├── backups/          # nightly pg_dump output
└── shared/           # cross-app files (rare — prefer the DB/API)
```

Rules: apps **never** reach into each other's folders (talk via API or the DB);
**one Postgres install, separate databases** per app (`ccr_platform`,
`ccr_website`, …); one Caddyfile maps subdomains → ports. Claude Code on the
server runs from `/srv/ccr/` so the whole tree is in scope, and **git is the
bridge** — anything fixed on the box gets committed and pushed back.

---

## Deploy steps

### 1. Provision the box
Ubuntu 24.04 LTS VPS (DigitalOcean, Hetzner, Linode…). Install Node 20, PostgreSQL,
and Caddy:

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql caddy git
```

### 2. Postgres + schema
```bash
sudo -u postgres createuser ccr_admin --pwprompt
sudo -u postgres createdb ccr_platform -O ccr_admin

# Apply the schema (idempotent — safe to re-run). No psql knowledge needed:
export DATABASE_URL="postgres://ccr_admin:<password>@localhost:5432/ccr_platform"
npm run migrate    # runs db/1_init_schema.sql — creates every table
```

### 3. App
```bash
sudo mkdir -p /srv/ccr && cd /srv/ccr
git clone https://github.com/Slat3ruk/ccr-platform.git data-platform
cd data-platform
npm install
npm run build

# .env.local (see .env.example for the full list)
#   DATABASE_URL=postgres://ccr_admin:<password>@localhost:5432/ccr_platform
#   NEXT_PUBLIC_API_URL=https://data.crosscurrentracing.com
#   NODE_ENV=production
#   GOOGLE_SHEETS_* are OPTIONAL (only for live benchmark re-sync; seeded tiers work without)
```

Run it as a persistent process — **pm2** (or a systemd service):
```bash
sudo npm i -g pm2
pm2 start "npm start" --name ccr-data      # serves on :3000
pm2 save && pm2 startup                     # survive reboots
```

### 4. Reverse proxy + HTTPS (Caddy)
`/etc/caddy/Caddyfile` — Caddy fetches + renews the TLS cert automatically:
```
data.crosscurrentracing.com {
    reverse_proxy localhost:3000
}
```
```bash
sudo systemctl reload caddy
```
Point a DNS `A` record for `data` at the VPS IP (and an `AAAA` record at the IPv6
if you want dual-stack). Add more apps as more subdomain blocks
(`planner.crosscurrentracing.com { reverse_proxy localhost:3001 }`, …).

#### ⚠ Temporary access gate (REQUIRED until real auth exists)
The app has **no login yet** — a client-side role toggle, so anyone who reaches
the URL can act as Admin and purge data. Until the website's Discord OAuth + the
app's verify layer are built, put the whole subdomain behind a **shared-password
gate** so the team can use it but the public can't. Add `basic_auth` to the block:
```
data.crosscurrentracing.com {
    basic_auth {
        # user + a bcrypt hash. Generate the hash with:  caddy hash-password
        crossteam <PASTE-BCRYPT-HASH-HERE>
    }
    reverse_proxy localhost:3000
}
```
Generate the hash with `caddy hash-password` (it prompts for the password), paste
it in, `sudo systemctl reload caddy`. The team logs in with the one shared
password. When the real Discord auth lands, delete the `basic_auth { … }` block.
This keeps the app **live on its domain and usable** without being wide open.

### 5. Seed reference data (once)
Open the site and click **"Load sample data"** on the rankings banner, or
`POST /api/seed`. Loads the car roster, tracks, and 145 benchmark tiers, then
computes rankings. Drivers can log from anywhere after this.

**Verify:** `GET /api/seed` should report `"backend": "postgres"` (not `json`),
and a logged session should survive an app restart (`pm2 restart ccr-data`).

---

## Auth (when the website's OAuth is live)

Nothing to configure on the box for auth today. The team website does the Discord
sign-in and sets a cookie scoped to `.crosscurrentracing.com`; because this app is
a subdomain it receives that cookie automatically. The app-side work is a small
**verify** layer (read cookie → validate → user + role → enforce server-side),
which replaces the client-side view-as toggle — tracked in the `CLAUDE.md` release
plan. Until that lands, the app is open to anyone who can reach the subdomain, so
keep it unlisted / behind the site until the verify layer is in.

---

## Optional: Docker instead of bare-metal

If you'd rather containerise, a `docker-compose.yml` with a `postgres:15` service
plus the app image works the same way (Caddy still fronts it). Bare-metal + pm2 is
lighter for a single small app; Docker is tidier if you're running several.

---

## Backups & ops

Backups live in `/srv/ccr/backups/`. Daily dump + 30-day retention:

```bash
# /srv/ccr/backups/backup.sh  (chmod +x)
#!/bin/bash
set -euo pipefail
export DATABASE_URL="postgres://ccr_admin:<password>@localhost:5432/ccr_platform"
pg_dump "$DATABASE_URL" > "/srv/ccr/backups/ccr_platform_$(date +%Y%m%d).sql"
find /srv/ccr/backups -name "ccr_platform_*.sql" -mtime +30 -delete
```

```bash
# Cron it daily at 04:00 (crontab -e):
0 4 * * * /srv/ccr/backups/backup.sh >> /srv/ccr/backups/backup.log 2>&1
```

**Restore** (into a scratch DB first if you just want to inspect; straight over
the live DB in a real emergency — this drops and recreates its contents):

```bash
# Emergency restore over the live DB:
sudo -u postgres psql -c "DROP DATABASE ccr_platform;" \
                  -c "CREATE DATABASE ccr_platform OWNER ccr_admin;"
psql "$DATABASE_URL" < /srv/ccr/backups/ccr_platform_<DATE>.sql
pm2 restart ccr-data
```

**⚠ Restore round-trip test (REQUIRED once, at deploy time):** never let the
first restore be during an emergency. Right after the smoke test: take a backup,
restore it into a scratch DB (`createdb ccr_restore_test`, `psql` the dump in,
sanity-query a table, `dropdb ccr_restore_test`). Confirm the dump actually
round-trips, then delete the scratch DB.

```bash
pm2 logs ccr-data          # app logs
pm2 restart ccr-data       # restart after a deploy
```

**Deploy an update:** `git pull && npm install && npm run build && pm2 restart ccr-data`.

---

## Troubleshooting

**Database connection errors** — check `DATABASE_URL`; test with
`psql "$DATABASE_URL" -c "SELECT 1"`. Ensure Postgres is listening on localhost.

**App won't start** — `pm2 logs ccr-data`; confirm `npm run build` succeeded and
`DATABASE_URL` is set in the process environment.

**HTTPS / cert issues** — check `sudo journalctl -u caddy`; the DNS record must
point at the VPS before Caddy can issue the cert.
