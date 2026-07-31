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

**From the data-platform session. Repo `Slat3ruk/ccr-platform`, branch
`master`. Last revised 2026-07-29 — supersedes the 2026-07-22 version, which
was written at `f2356ee` and is now several features out of date.**

Everything below landed **after `DEPLOY-RUNBOOK.md` was written (2026-07-21)**, so
the runbook's post-deploy checklist does not yet cover it. Ring-leader session:
fold the relevant parts into the runbook.

> **Check you are reading the current version.** This statement is revised in
> place as work lands. Confirm `git log -1 --format=%cd -- DEPLOY.md` on
> `origin/master` is not older than the newest commit in the repo; if it is, the
> statement has drifted behind the code and should be re-read after a pull.

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

### ⚠ TWO STEPS THAT ARE NOT OPTIONAL — both silent if skipped

1. **`npm run migrate`** (above).
2. **"Sync from Ohne Speed"** — control panel → Benchmarks, AFTER seeding and
   after reconnecting the webhooks. Full reasoning in §5; the short version is
   that **a freshly seeded database has no Wet benchmarks at all**, and
   `recomputeAll` silently falls back to the Dry benchmark, so every wet session
   is scored against dry pace. No error, just wrong numbers.
   **Verify:** `GET /api/benchmarks` must return rows with `"condition": "Wet"`.

Neither failure announces itself. Both look like a working deploy.

### ⚠ THE SEED DATA WAS WRONG AND IS NOW FIXED — relevant because production seeds from it

`src/data/benchmarks.json` still carried the pre-`279a09a` off-by-one column
mapping: every tier from "good" downward was one column too fast (Bahrain wec
LMGT3 seeded `good` 121.47 where the sheet means 122.66, `offline` 125.04 where
it means 127.43). Production seeds into a **blank** database, so a fresh deploy
would have scored every driver against tiers up to ~2.4 s too strict, invisibly,
until someone happened to sync. Regenerated from the live sheet: **29 → 31
tracks, 145 → 155 benchmark rows**, now carrying the 102%/104% sub-tiers that
`seed.ts` previously hardcoded to `null`. Verified by running a genuine fresh
seed, not by inspection.

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
- **A VE-per-lap value below 0.5 % is now rejected** with
  *"looks like a 0–1 fraction rather than a percentage — enter 2.8 for 2.8%,
  not 0.028"*. LMU's shared memory carries VE as a 0..1 fraction while this app
  stores a percentage, so an un-converted value used to pass every check and
  silently record a burn 100× too low. A refusal here is the guard working.
- **Two new circuits: Daytona and Laguna Seca**, from the Ohne Speed sheet's
  2026-07-29 update, with full benchmark coverage. Named in the sheet's short
  form (`Daytona`, `Laguna Seca`) — deliberately NOT "WeatherTech Raceway Laguna
  Seca", because the sync matches on letters+digits only and the long name would
  create a duplicate on the next sync.

### Security change — may break anything scripted

`POST /api/cars` and `POST /api/tracks` previously accepted **any authenticated
member** (no role check at all). Both now require **manager/admin** and return
409 on a duplicate name instead of silently upserting. Anything automated hitting
those endpoints will start getting 403.

### Post-deploy checks (in addition to the runbook's)

- [ ] Sign in as a **manager** → control panel loads; Purge and Discord webhooks
      are **absent**.
- [ ] Log form → Consumption card present; select an LMP2 car → VE field greys out.
- [ ] **Log one `Dry` and one `Wet` session on the same car+track** and confirm
      each returns a non-null `car_score` from
      `GET /api/rankings?track_id=<ID>&class=<CLASS>&condition=<Dry|Wet>`. This
      is the only check that proves the app can SCORE on PostgreSQL rather than
      merely persist — see §5. Delete both afterwards; production starts clean.
      ⚠ A wet session still scores when Wet benchmarks are missing (Dry
      fallback), so pair this with the `"condition": "Wet"` check above.
- [ ] Control panel → Tracks → **"Fill known distances"** → fills **15 of 31**
      circuits, leaves the 16 layout variants blank. Press it twice: the second
      run must report 0 filled (it never overwrites).
- [ ] Log form → enter VE per lap **0.028** → must be REJECTED with the
      "looks like a 0–1 fraction" message. Proves the guard survived the
      Postgres switch; it is the only new user-visible rejection.
- [ ] Set one distance by hand, then **Sync from Ohne Speed** → the hand-entered
      value must survive. *(Proven against the JSON dev store and true by
      construction in Postgres, but never exercised on the real DB — worth doing
      once before backfilling the rest.)*
- [ ] Control panel → **Download sessions CSV** → opens in Excel with accents
      intact and columns aligned.
- [ ] Submit the same session twice → second attempt warns rather than saving.

### Not blocking, worth knowing

- Lap distances are **reference data only** — nothing computes fuel from them in
  either app, so blanks are harmless. 15 of 31 fill automatically; the other 16
  are layout variants we deliberately refuse to guess. Read real values off
  scoring shared memory in-game (`track_length`), NOT off LMU's track-info
  splash panel — that panel is published spec and is wrong in both directions
  (Laguna 12 m long, Daytona ~5 m short vs measured).
- The CSV export is an **archive, not the backup of record**. `pg_dump` remains
  the thing an actual restore uses.
- **`AUTH_DEV_MODE` must be absent** from the server environment and the systemd
  units. `NODE_ENV=production` blocks it independently, but check anyway — if it
  ever leaked in, every request would authenticate as a fake admin.

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

### 5. Seed reference data (once), then SYNC
Open the site and click **"Load sample data"** on the rankings banner, or
`POST /api/seed`. Loads the car roster, 31 tracks, and 155 Dry benchmark tiers,
then computes rankings.

#### ⚠ Then run "Sync from Ohne Speed" — seeding alone is NOT enough
Control panel → Benchmarks → **Sync from Ohne Speed** (or `POST /api/benchmarks/sync`).
Two reasons, both real:

1. **A fresh seed has NO WET BENCHMARKS AT ALL.** The seed file carries Dry only,
   because Wet is *derived* from Dry via the wet-penalty setting — and that
   derivation only runs inside the sync (or a wet-penalty save), never inside
   seeding. Until it runs, `recomputeAll` falls back to the Dry benchmark for
   wet sessions (see the fallback in `lib/recompute.ts`), so **every wet session
   is scored against dry pace and its driver looks slower than they are.** It
   degrades silently — no error, just wrong numbers.
2. **The seed is a point-in-time snapshot** (Ohne Speed as of 2026-07-29). The
   sheet gains tracks and re-times tiers; the sync pulls the current state and
   auto-creates any circuits the sheet has gained since (this is how Daytona and
   Laguna Seca arrived).

**Verify the sync:** the response reports `upserted` (≈155+) and any
`created_tracks`. Then check a wet benchmark exists —
`GET /api/benchmarks` should contain rows with `"condition": "Wet"`. If there
are none, the sync did not complete and wet scoring is still wrong.

Drivers can log from anywhere once both steps are done.

**Verify:** `GET /api/seed` should report `"backend": "postgres"` (not `json`),
and a logged session should survive an app restart (`pm2 restart ccr-data`).
**Also do a one-time full reboot test** (`sudo reboot`): after the box comes
back, confirm the app and Postgres started on their own (`pm2 list`, load the
site) and the session persists — proves `pm2 save && pm2 startup` + Postgres
auto-start survive a real reboot, not just an app restart. (Warn the user first;
SSH drops briefly.)

#### ⚠ Then verify SCORING, not just persistence

The checks above prove rows survive. They do **not** prove the app can score,
and this is the first time any of this code has run on PostgreSQL rather than
the JSON dev store — every store method is a separate SQL implementation that
has only ever been exercised against JSON. Log **two sessions on the same
car+track, one `Dry` and one `Wet`**, then confirm both appear with a car score:

```bash
# after logging, rankings must contain the combo with a non-null car_score
curl -s "http://localhost:3000/api/rankings?track_id=<ID>&class=<CLASS>&condition=Dry" | head -c 400
curl -s "http://localhost:3000/api/rankings?track_id=<ID>&class=<CLASS>&condition=Wet" | head -c 400
```

That one exercise covers the paths most likely to break on first contact with
real SQL: `getOrCreateDriverByDiscordId` (identity binding on every write), the
session insert, `recomputeAll`, benchmark lookup, and the tyre join.

⚠ **A wet session scores even when wet benchmarks are missing** — `recomputeAll`
silently falls back to the Dry benchmark (see §5). So "it produced a score" does
NOT prove the wet path is healthy. The two checks are independent and you need
both: a car score here, **and** `GET /api/benchmarks` containing
`"condition": "Wet"` rows from §5. Score but no Wet rows = wet running is being
judged against dry pace.

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

**Run "Sync from Ohne Speed" after every update, not just the first deploy.**
It is cheap, idempotent and fixes two things a `git pull` cannot:
- new columns are NULL on pre-existing rows until a sync populates them (e.g.
  the 102%/104% sub-tiers);
- the sheet gains circuits and re-times tiers between deploys, and the sync is
  the only thing that pulls them in (it auto-creates tracks the sheet has that
  the DB doesn't — that is how Daytona and Laguna Seca arrived).
It also re-derives the Wet benchmarks. See §5 for why that matters.

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
