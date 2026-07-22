# Deployment Guide — CrossCurrent Racing Platform

> **🚨 Deploying as part of the multi-app catch-up? Read the cross-app runbook
> FIRST: `DEPLOY-RUNBOOK.md` in the CCR-Website repo.** This guide covers *this
> app in isolation*; the runbook covers what it can't — the order the apps must
> go in (this one is third: after `ccr-auth` and `ccr-data-service`, before the
> website, which consumes this app's new `/api/public/stats`), and the
> post-deploy behaviour checks. Most importantly: the patch-weighting fix
> **deliberately re-scores existing sessions** — higher Representativeness on
> hotfix-only-older setups, and slightly reordered car rankings. That is the fix
> working, not data corruption.

---

## 📦 DEPLOYMENT STATEMENT — this repo's input to the catch-up deploy

**From the data-platform session, 2026-07-22. Repo `Slat3ruk/ccr-platform`,
branch `master`, HEAD `f2356ee`.**

Everything below landed **after `DEPLOY-RUNBOOK.md` was written (2026-07-21)**, so
the runbook's post-deploy checklist does not yet cover it. Ring-leader session:
fold the relevant parts into the runbook.

### ⚠ Migrations — `npm run migrate` is mandatory

Three new columns, all nullable, all `ADD COLUMN IF NOT EXISTS`, safe to re-run:

| Column | Purpose |
|---|---|
| `tracks.length_km` | Lap distance (reference data for future strategy work) |
| `sessions.fuel_per_lap` | Litres/lap — captured, not scored |
| `sessions.ve_per_lap` | Virtual Energy %/lap — captured, not scored |

**Do not infer the need to migrate from commit messages this batch.** Two of
these arrived inside `ca0ced3`, whose message describes only a docs change (a
parallel session's catch-all `git add`; see `dfae22f` for the record). Always
run migrate.

### Behaviour changes — will look different, and are CORRECT

- **The control panel now opens to Team Managers** (was admin-only). They see
  Status, Export, Cars, Tracks & layouts, Wet pace penalty. **Purge, Discord
  webhooks and patch/era lines remain admin-only and are hidden from them.** A
  manager suddenly having control-panel access is intended, not a bug.
- **New Cars and Tracks & layouts cards**, both with Delete buttons that
  **refuse with an explanation** when anything references the item ("still has 6
  logged sessions…"). That refusal is the safety feature working — every FK is
  `ON DELETE CASCADE`, so an unguarded delete would silently destroy logged data.
- **Log form has a new "Consumption" card** (fuel L/lap, VE %/lap, both
  optional). **The VE field greys out for LMP2/LMP3** — correct, those classes
  have no Virtual Energy in LMU.
- **Logging the same run twice is now refused once** with a 409 and a "log it
  again anyway?" confirm. Strict match (same driver/car/track/condition AND
  identical lap count and both lap times, within 6h), so two genuinely different
  stints on one combo still log normally.

### Security change — may break anything scripted

`POST /api/cars` and `POST /api/tracks` previously accepted **any authenticated
member** (no role check at all). Both now require **manager/admin** and return
409 on a duplicate name instead of silently upserting. Anything automated hitting
those endpoints will start getting 403.

### Post-deploy checks (in addition to the runbook's)

- [ ] Sign in as a **manager** → control panel loads; Purge and Discord webhooks
      are **absent**.
- [ ] Log form → Consumption card present; select an LMP2 car → VE field greys out.
- [ ] Control panel → Tracks → **"Fill known distances"** → fills ~13 base
      circuits, leaves layout variants blank. Press it twice: the second run must
      report 0 filled (it never overwrites).
- [ ] Set one distance by hand, then **Sync from Ohne Speed** → the hand-entered
      value must survive. *(Proven against the JSON dev store and true by
      construction in Postgres, but never exercised on the real DB — worth doing
      once before backfilling the rest.)*
- [ ] Control panel → **Download sessions CSV** → opens in Excel with accents
      intact and columns aligned.
- [ ] Submit the same session twice → second attempt warns rather than saving.

### Not blocking, worth knowing

- Lap distances are **reference data only** — nothing scores on them, so blanks
  are harmless. 13 of 29 get filled automatically; the rest are layout variants
  we deliberately refuse to guess (a wrong lap distance would quietly corrupt
  future fuel maths). Easiest source is the in-game HUD.
- The CSV export is an **archive, not the backup of record**. `pg_dump` remains
  the thing an actual restore uses.

---

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

> **⚠ This box is NOT bare — the team website is already live here** (`crosscurrentracing.com`),
> so Caddy and Node are probably already installed and Caddy is serving a working
> config. **Check before installing** (`caddy version`, `node --version`,
> `psql --version`) and install **only what's missing** — PostgreSQL is the likely
> gap. Do NOT blindly `apt install caddy` over a running one, and never overwrite
> the existing Caddyfile (§4 explains how to add to it safely).

```bash
# Only the pieces that step-0 survey showed are missing. Typically just Postgres:
sudo apt install -y postgresql git
# Node 20 (skip if `node --version` already shows v20+):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
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
**The Caddyfile already exists and has a working `crosscurrentracing.com` block
for the live website — APPEND to it, do not replace it.** Add this block alongside
the existing website block in `/etc/caddy/Caddyfile`; Caddy fetches + renews the
TLS cert automatically:
```
data.crosscurrentracing.com {
    reverse_proxy localhost:3000
}
```
```bash
sudo caddy validate --config /etc/caddy/Caddyfile   # MUST pass before reloading
sudo systemctl reload caddy
curl -sI https://crosscurrentracing.com | head -1   # confirm the website is STILL up
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
**Also do a one-time full reboot test** (`sudo reboot`): after the box comes
back, confirm the app and Postgres started on their own (`pm2 list`, load the
site) and the session persists — proves `pm2 save && pm2 startup` + Postgres
auto-start survive a real reboot, not just an app restart. (Warn the user first;
SSH drops briefly.)

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

### ⚠ FIRST — reconcile the box with git (before ANY pull)

The server may hold work git doesn't: hotfixes applied directly on the box that
were never committed, or committed but never pushed. Pulling on top of that
conflicts or loses it. **Always run this comparison first and report it to the
user before changing anything:**

```bash
cd /srv/ccr/data-platform
git fetch origin

git status                              # uncommitted edits made ON the box?
git stash list                          # anything parked in a stash?
git log --oneline origin/master..HEAD   # ⚠ commits HERE that are NOT on origin
git log --oneline HEAD..origin/master   # commits incoming from origin
git diff --stat HEAD origin/master      # which files the update touches
```

Read it in this order: **anything in the first three means STOP and reconcile**
(commit + push the box's work, or deliberately discard it — ask the user, don't
guess). Only when the box is clean and has nothing unpushed is the update below
safe. Repeat the same check for every repo on the box (`website/`, etc.).

### Deploy an update

```bash
cd /srv/ccr/data-platform
git pull
npm install          # lockfile may have moved
npm run migrate      # ⚠ DO NOT SKIP — see below
npm run build
pm2 restart ccr-data
```

**⚠ `npm run migrate` is REQUIRED on every update, not just the first deploy.**
`db/1_init_schema.sql` is written to be idempotent for BOTH cases: fresh installs
get `CREATE TABLE IF NOT EXISTS`, and **existing** databases get the newer columns
via `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (e.g. `benchmarks.good_102_time` /
`midpack_104_time`, `sessions.lap_times` / `setup_type`, `races.start_at`,
`recommendations.weights_preset` / `best_setup`). Skipping migrate on an
already-live box means the code ships expecting columns the DB doesn't have —
the failure shows up as runtime SQL errors on the affected page, not at build
time. Re-running it when nothing changed is a harmless no-op.

**After a migrate that added benchmark columns:** the new columns are NULL on
pre-existing rows until the next benchmark sync — hit "Sync from Ohne Speed" in
the control panel to populate them.

**Sanity checks after any update:** `pm2 logs ccr-data --lines 50` for startup
errors; load the site; and confirm **`AUTH_DEV_MODE` is NOT set** in the server
environment (`pm2 env 0 | grep AUTH_DEV` should return nothing — it's a
local-dev-only flag that would fake an authenticated admin if it ever leaked
into production; `NODE_ENV=production` independently blocks it, but check anyway).

---

## Troubleshooting

**Database connection errors** — check `DATABASE_URL`; test with
`psql "$DATABASE_URL" -c "SELECT 1"`. Ensure Postgres is listening on localhost.

**App won't start** — `pm2 logs ccr-data`; confirm `npm run build` succeeded and
`DATABASE_URL` is set in the process environment.

**HTTPS / cert issues** — check `sudo journalctl -u caddy`; the DNS record must
point at the VPS before Caddy can issue the cert.
