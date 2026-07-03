# CLAUDE.md — CrossCurrent Racing Data Analysis Platform

## Project

**CrossCurrent Racing Platform** — a data-driven car-to-track recommendation engine for Le Mans Ultimate endurance racing.

**Purpose:** Analyze logged test sessions (lap times, tyre wear, off-track incidents, driver feedback, setup data) and deterministically rank cars per track/class to guide engineering decisions before race day.

**Not:** a race strategy executor or live telemetry system. Strictly pre-race engineering intelligence.

## Tech Stack (MVP Phase 1)

- **Frontend:** Next.js (React 19, TypeScript, Vite)
- **Backend:** Next.js API routes
- **Database:** PostgreSQL (Netlify Postgres or external)
- **Hosting:** Netlify (frontend + API)
- **Auth:** Discord OAuth (Phase 2)
- **Benchmark data:** Google Sheets API (daily sync)

## Key Design Decisions (Grilled & Locked)

### Scoring Model
- **5 factors:** Pace (35%) + Consistency (25%) + Tyre (15%) + Drivability (15%) + Mistakes (10%)
- **Aggregation:** Per-car-per-track, latest 10 sessions, weighted by Session Value Score
- **Pace benchmark:** Externe "Ohne Speed" spreadsheet (Alien/Competitive/Good/Midpack tiers)
- **Tyre wear:** Average % across 4 tyres; no benchmark (comparative only)
- **Consistency:** Lap-to-lap variance normalized by lap time: `100 × (1 − std_dev ÷ avg_laptime)`
- **Drivability:** Driver confidence rating (1-10 slider)
- **Mistakes:** Off-track count (max ~3 per 10-15 laps); normalized to expected max

### Session Value Score (weighting)
Completeness 30% + Consistency 25% + Cleanliness 20% + Representativeness 15% + Recency 10% = impact on car score aggregation.

### Benchmark Data
- **Source:** Google Sheets (Ohne Speed LMU laptimes spreadsheet)
- **Sync:** Automated daily via API; fallback to cached data if sync fails
- **Update:** Tracks Alien/Competitive/Good/Midpack times per track/class/condition
- **Admin:** Can manually trigger sync or upload CSV

### Data Flow
1. Driver logs session: driver name, car, track, lap count, best/avg time, tyre % (4x), off-tracks, confidence, setup version, optional SVM file
2. Data persists to PostgreSQL (not localStorage)
3. Scoring engine ingests 10 latest sessions per car-track combo
4. Computes Car Score + 5 factors
5. Frontend displays rankings; engineers/admins see detailed breakdowns

### Output Format
```json
{
  "car": "Porsche 992",
  "track": "Le Mans",
  "class": "LMGT3",
  "score": 87.3,
  "factors": {
    "pace": 85,
    "consistency": 90,
    "tyre": 88,
    "drivability": 89,
    "mistakes": 82
  },
  "sessions_used": 8,
  "last_updated": "2026-06-30T14:22:00Z",
  "confidence": 0.87
}
```

## MVP Phase 1: Core App Functionality

**Goal:** Session logging + scoring engine + rankings. No auth, no admin overrides, no SVM parsing yet.

1. ✅ Design spec locked (this document)
2. Database schema + PostgreSQL setup
3. Next.js scaffold + API endpoints
4. Session logging form (UI matching the Netlify app prototype)
5. Scoring engine (5-factor calculation)
6. Rankings dashboard (cars per track, sortable)
7. JSON/CSV export
8. Benchmark sync (Google Sheets API)
9. Test & iterate

## Phase 2: Auth & Admin Features

- Discord OAuth + RBAC (driver/engineer/admin roles)
- Admin trust system (hidden weighting on driver contributions)
- Admin override logging & audit trail
- SVM setup parsing (diagnostics)
- Patch versioning decay weighting

## Phase 3: Advanced

- Machine learning insights (predictive pit strategies, setup recommendations)
- Cloud-descriptor calibration (external telemetry integration)
- SQLite persistence for offline mode
- Native tray app / auto-start

## Known Gotchas

- **Tyre wear is comparative, not absolute.** No "ideal" wear rate yet — just rank drivers by harshness on the same car-track combo.
- **Session Value Score weighting is critical.** A single messy session can skew rankings if not weighted by quality.
- **Benchmark data freshness:** Google Sheets API sync must be reliable; graceful fallback to cached data.
- **Off-track count normalization:** scales with lap count to avoid penalizing short sessions.

## Decisions Left for Phase 2+

- Exact Session Value Score formula (all 5 components)
- Trust system weighting formula
- Patch decay curve (how old data loses weight)
- SVM parsing: which parameters matter most (TC, ABS, brake bias, diff, suspension)?
- Admin override logging: what gets logged, who sees it?

## Brand & Style

- **Team:** Crosscurrent Racing (US/UK simracing)
- **Accent:** #e81123 (red)
- **Style:** Discord-inspired dark UI (driver-friendly), carrying the CCR red accent.

## Build Status — Phase 1 (implemented & verified in-browser)

Next.js App Router + React 19 + TS. `npm run build` and `tsc --noEmit` pass; the
full flow (seed → log sessions → ranked recommendations → detail expand → export)
was verified end-to-end. Structure:

- `src/types` contracts · `src/lib/scoring.ts` (pure 5-factor engine + SVS + aggregate)
  · `src/lib/recompute.ts` (groups by car/track/condition, scores latest 10) ·
  `src/lib/validation.ts` · `src/lib/time.ts` · `src/lib/benchmark-sync.ts`
  (Google Sheets, graceful fallback) · `src/lib/seed*.ts`.
- Data layer = a `Store` interface with **two backends** auto-selected in
  `src/lib/db/index.ts`.
- API route handlers under `src/app/api/*` (sessions CRUD, rankings, recompute,
  benchmarks, sync, cars, tracks, drivers, seed). All `runtime="nodejs"`.
- UI: `/` rankings (5s poll, filters, export, expandable factor breakdown),
  `/log` session form, `/sessions` log+delete, `/benchmarks` + sync. Discord shell.
- **Tests + deploy tooling (round 3):** `npm test` runs Vitest over the pure
  scoring engine (`src/lib/scoring.test.ts`, 25 cases — pace tiers, the absolute-
  seconds consistency regression, tyre/mistakes, SVS, the n/(n+1) confidence
  curve, and the weights presets/normalisation). `npm run migrate`
  (`scripts/migrate.mjs`) applies `db/1_init_schema.sql` via `DATABASE_URL` with
  no psql needed; DEPLOY.md opens with an ⚡ Quick start for the Neon + Netlify
  path (pooled connection, migrate, seed via the UI banner).
- **Quick wins (round 4):** (1) **Session editing** — `/sessions` rows have an
  Edit button that opens `SessionForm` in edit mode (prefilled via an `edit`
  prop, saves through `api.updateSession` → `PUT /api/sessions/[id]`, which now
  validates the full SessionInput + resolves the driver like POST, replacing the
  old loose-patch behaviour). (2) **Confidence colours harmonised** with
  `confidenceLabel` in format.ts — ≥0.8 High/green · ≥0.6 Solid/teal · ≥0.4
  Emerging/yellow · <0.4 Preliminary/orange (the dot and the word now agree).
  (3) JSON dev store honours **`CCR_DATA_DIR`** (json-store.ts) so `.data/`
  anchors to the app even when spawned with a foreign cwd — the `ccr-data-dev`
  preview launch sets it via `env`; fixed the store landing in the stint-planner
  folder. (Preview `cwd` can't point outside its project root, so `env` is the
  mechanism.)

### Three pragmatic build decisions (not in the original spec — flag if revisiting)

1. **Dual store (idiot-proof local dev):** Postgres when `DATABASE_URL` is set
   (production/Netlify, per the locked design), else a zero-config JSON store at
   `.data/store.json`. Same engine/UI either way. Docker isn't installed on this
   machine, so requiring Postgres to test locally would have blocked the manual
   feedback loop.
2. **Consistency = best→avg gap, scored in ABSOLUTE SECONDS** (fixed round 3).
   SPEC §3.2 wants std-dev of every lap, but the form (SPEC §5.1) logs only best +
   average + count, so we proxy dispersion with the best→avg gap. It's now scored
   `clamp(100 − gap/CONSISTENCY_TOLERANCE_S × 50)` (tolerance 2.0 s → 50 pts), NOT
   the old `100×(1 − gap/avg)`. The old formula divided the ~1 s gap by the ~140 s
   lap, crushing every car to ~98–99 — a dead 25% of the Car Score. Absolute
   seconds is the honest measure (a second of scatter costs the same positions at
   any track length); the real 0.7–1.8 s demo spread now maps to ~82→55, so
   consistency genuinely moves the ranking (and Car Scores dropped ~6 pts overall
   since it no longer inflates everyone).
   **Per-lap path (round 4, DONE):** sessions can carry `lap_times: number[]`
   (optional "paste your laps" textarea on the form — accepts M:SS.mmm or
   seconds, one-per-line/comma/space separated, tolerates leading lap numbers;
   `parseLapTimes` in time.ts; auto-fills best/avg/count). When ≥2 laps present,
   `sessionConsistency()` uses TRUE std-dev (`consistencyFactorFromLaps`,
   tolerance `CONSISTENCY_STDDEV_TOLERANCE_S`=1.2 s→50) after `cleanLaps()` trims
   traffic/out-laps (> `LAP_OUTLIER_FACTOR`=1.07 × median, slow side only — raw
   laps are stored untrimmed, trimming is scoring-time). No laps → best→avg
   proxy. Verified: a session with σ≈0.1 s but a 2.8 s best→avg gap scores ~95
   via laps where the proxy said 30. Postgres: `sessions.lap_times JSONB`
   (additive migration in init() + schema); rankings detail shows "⏱" on
   lap-timed sessions.
3. **Benchmarks are REAL** — imported from a saved copy of the "Ohne Speed" sheet
   (29 tracks/layouts × 5 classes = 145 Dry tiers, patch "1.3 +"). The importer
   `scripts/parse-ohne-speed.mjs` (run via `npm run import:benchmarks`) parses the
   saved-as-HTML export into committed `src/data/{benchmarks,tracks}.json`, which
   the seeder loads. Tracks are seeded from this list too (real names like "Spa",
   "Circuit de la Sarthe", "Bahrain (endurance)"). The live Google Sheets sync in
   `benchmark-sync.ts` is calibrated to the same column layout (class from col A
   suffix, tiers at cols E–J) for when an API key is configured. Re-run the
   importer after downloading a fresh sheet copy; the raw download is gitignored.

   **Sheet layout (decoded 2026-07-01):** per-class sections; each data row's
   col A = `<track><CLASS>`, B = track, C = patch, E–J = alien/competitive/good/
   midpack/tail-ender/offline (clean 1% steps; alien = ~100% column, NOT the
   faster "Class avgW" col D). GTE rows are skipped (no current LMU cars map to it).

### Feedback round 2 — status (requested 2026-07-01)

1. **[PENDING] Relabel the SVS debug abbreviations** in plain English (Admin
   detail view + anywhere they appear). Mapping: cmpl = Completeness ("did they
   run a proper stint / lap count"), cons = Consistency ("tight, repeatable
   laps"), clean = Cleanliness ("few off-tracks/mistakes"), repr =
   Representativeness ("race-relevant: Race/Quali > Practice/Test, dry vs wet"),
   rec = Recency ("fresh runs count more"). Use full words + a hover tooltip.
   Lives in `RankingsTable.tsx` (the `value_components` debug line, admin only).
2. **[DONE 2026-07-01] Adjustable factor weights with presets.** Locked design:
   ONE global, mathematically-derived ranking everyone sees — NOT a per-user
   what-if. Manager/Admin picks the weighting; it persists in the store's
   `settings` (key `weights`, a `WeightsConfig`) and every recompute reads it, so
   the list is shared. Transparency = each recommendation is stamped with its
   `weights_preset` name, shown as a Discord-style tag next to the car (point the
   user made: "small little tags … with those names next to them"). Presets in
   `scoring.ts` `WEIGHT_PRESETS` (Balanced 35/25/15/15/10, Pace-focused,
   Tyre-saver, Sprint); a Custom mode (sliders, normalised to sum 1 server-side).
   `aggregateCarScore(scored, weights)` takes the weights; `recomputeAll(store,
   nowMs, config?)` reads/writes the active config. UI: `WeightsControl.tsx` in
   the rankings toolbar (Manager/Admin editable, Driver read-only); endpoint
   `GET/POST /api/rankings/weights` (POST validates, persists, recomputes).
3. **[DONE 2026-07-01] BLUF "Race Briefing" landing page** — `/briefing`, first
   sidebar item (new "Race weekend" section). Manually-added race calendar
   (`races` store collection; `GET/POST /api/races`, `PATCH/DELETE
   /api/races/[id]`). Calendar logic in `lib/calendar.ts`: a race is the
   FEATURED briefing from `LEAD_DAYS=3` before its `event_date` (the user's 3-day
   cut-off → opens Wednesday for a Saturday race) through `TRAIL_DAYS=1` after
   (stays live through Sunday); nearest in-window event wins, else the next
   upcoming shows as "Coming up". Team races Saturday-main with Fri/Sun optional —
   tune the two constants to shift the window. BLUF card auto-pulls the top-ranked
   car for the featured track (+ its class/condition) with the weighting tag, an
   alternatives list, and an engineer's `note` (stored ON the race row: `note` /
   `note_by` / `note_updated_at`; PATCH to set). Editing gated to Manager/Admin;
   drivers read-only. Add-race form + Remove gated the same way.

**Store/schema note (round 2):** the `Store` interface gained `getSetting`/
`setSetting` (KV) and race CRUD; both the JSON dev store and Postgres implement
them. Postgres `init()` now runs additive `CREATE TABLE IF NOT EXISTS`
(settings, races) + `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS
weights_preset`, so an already-migrated prod DB self-heals without re-running
`db/1_init_schema.sql` (which also carries the new DDL for fresh DBs).

### Data eras + admin control panel (round 5, 2026-07-02)

**Eras — "lines in the sand", fully recallable (nothing auto-deletes).** An era
is a named timestamp boundary (`eras` store collection / `ccr.eras` table),
typically drawn when an LMU patch/BoP change makes older data non-comparable.
Sessions are assigned by `created_at` — no FK, no row migration — so deleting an
era ("Undo line") merges its sessions straight back. Boundary logic is pure in
`src/lib/eras.ts` (`currentEra` = latest `starts_at <= now`; none ⇒ implicit
"all data" era = exact pre-feature behaviour; future-dated eras are inert until
reached; ranges are `[starts_at, next.starts_at)`, newest open-ended). 14 tests.

- **Live board = current era only.** `recomputeAll` filters sessions through
  `currentEraRange` before scoring. The scoring core is now extracted as
  `scoreGroups(sessions, cars, benchmarks, config, nowMs)` (pure, no store
  writes) shared by both paths.
- **Archived eras are viewable, not persisted:** `GET /api/rankings?era_id=N`
  (or `era_id=pre` for the span before the first era) recomputes that era
  ad-hoc via `scoreGroups` and returns rows with negative ids. The rankings
  page gets an Era selector (manager/admin, only when eras exist) + an amber
  "viewing archived era" banner; `RankingsTable archived` prop suppresses the
  contributing-sessions expander there (the sessions endpoint serves current
  data, so listing would mislead).
- **API:** `GET/POST /api/eras` (POST recomputes; `starts_at` optional,
  backdating allowed), `DELETE /api/eras/[id]` (recomputes). **Purge** =
  `POST /api/admin/purge` requiring body `{confirm:"PURGE"}` — deletes ALL
  sessions (tyres cascade), clears recommendations; cars/tracks/benchmarks/
  eras/races/settings survive. Verified end-to-end incl. purge (backup→purge→
  restore dance, since the dev store is memory-cached).
- **`/control-panel`** (admin-gated client-side; sidebar "Admin" section only
  renders for the admin role): status cards (current era, weighting, sessions,
  rankings + recompute), "draw a line" form (name/reason/optional backdate via
  datetime-local), era history with per-era "Undo line", and a danger zone
  where purge only arms after typing PURGE. **This page is slated to be
  dressed as the GT3 steering-wheel overlay** (`public/steering-wheel-logo.png`,
  transparent, logo baked into the LCD) — dials on the wheel's rotaries, status
  panel beside it. Features first, dressing later (user decision).

### Feedback round 1 (2026-07-01)

- **Confidence uses a diminishing-returns curve** (updated round 3):
  `volume = n/(n+CONFIDENCE_CURVE_K)` (k=1) × avg session quality (avgSVS/100).
  No hard cap — more runs always raise it with tapering reward, so a car with
  many runs still out-trusts one with few. A clean 3-run sample reads ~71%
  ("Solid"), 5→~79%, 8→~84%. History: round 1 moved off the old 10-session
  target to a 5-session linear cap (`CONFIDENCE_TARGET_SESSIONS`, now removed);
  round 3 replaced the cap with the smooth curve because 57%@3-runs read too low
  for a top, all-green pick. Aggregation window is still the latest 10.
  `confidenceLabel`/`confidenceTitle` (format.ts) drive a hover tooltip on the
  rankings + briefing clarifying it's *data-backing, not pace*.
- **Comments + setup are surfaced**: Notes/Setup columns on #session-log (Notes
  truncates with full-text-on-hover), and setup/💬-comment lines in the rankings
  detail expander.
- **View-as role toggle** (`src/lib/role.tsx`, sidebar footer) — Driver / Team
  Manager / Admin, persisted in localStorage, mapping to the planned Discord
  roles. Driver = car + score + verdict only; Team Manager = full factor
  breakdown (default); Admin = + Recompute button + per-session SVS component
  debug. Phase 2 replaces this with real Discord-OAuth RBAC.
