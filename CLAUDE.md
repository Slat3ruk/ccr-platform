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

### Per-driver weighting (lens) + preset-winners strip (round 12, 2026-07-04)

Both from one client-side primitive — `weightedFactorScore(factors, weights)` in
scoring.ts: a recommendation stores its five factor scores, so `car_score =
Σ factor×weight` can be re-computed in the browser, re-ranking the board under
any preset with NO server recompute (non-destructive, instant).
- **"My view" lens** (rankings toolbar, EVERYONE incl. drivers): "" = team
  default (server order); a preset re-ranks the loaded rows client-side, tag +
  score updated, re-sorted. Persisted per viewer in `localStorage` (`ccr-view-
  lens`) → profile-backed with auth. Active-lens note + "back to team default".
- **Global weighting is now the TEAM DEFAULT**: `WeightsControl` gated to
  manager/admin (relabelled "Team default"); drivers no longer mutate everyone's
  board — they get a personal lens. Supersedes round 11's driver-sets-global.
- **Preset-winners strip** (`PresetWinners.tsx`): top car under each preset from
  the loaded rows, scoped to the current filter; chips differing from Balanced
  highlighted (purple), click a chip to apply/clear that lens.
- Caveat: re-weights EXISTING factors, doesn't re-pick the best setup (weight-
  dependent, server-side) — a faithful re-rank, close approximation for setup.
- 75 tests (3 new: Balanced parity, a Tyre-saver-vs-Pace flip, normalisation).
  Verified live both roles; driver sees lens+strip but not Team default.

### Test coverage map (round 13, 2026-07-04)

New `/coverage` page ("coverage" in the Engineering sidebar): tracks × cars grid
per class + condition, coloured by CURRENT-ERA session volume — "where are we
blind?" Directs testing time at the combos the engine knows nothing about.
Tiers align with the model (0 none / 1–2 thin, below the 3-run bar / 3–5
building / 6+ solid); tooltips show count · drivers · last-run age; tracks with
an upcoming race pin to the top (📅 + accent bar); headline "N/total combos at
the 3-run bar". Era-scoped like the live board. Entirely client-side from
existing APIs — no new endpoints/schema. Read-only v1; test-request pinning
(manager pins a cell → briefing) is a possible v2. Verified live: 290 GT3
combos, 2 at the bar; Imola pinned via its race; Wet honestly all-zero.

### Discord webhook announcements (round 14, 2026-07-04)

One-way pushes into the team channel via a plain channel webhook — **no bot, no
OAuth, no Discord application, nothing hosted**. Admin pastes the URL into the
"Discord announcements" control-panel card (save / disconnect / send-test; URL
shape validated; GET returns a masked hint only). Fires on REAL changes only:
- **Board #1 takeovers** — `recomputeAll` snapshots the outgoing board, diffs
  the #1 per (track,class,condition) via pure `diffTopCars` (lib/discord.ts),
  posts ONE batched message (≤8 lines + "and N more") tagged with the preset.
  New/vanished boards are not flips; no-change recomputes stay silent.
- **New era** (with reason) · **new tracks from a benchmark sync**
  (`SyncResult.created_tracks`); routine re-syncs stay quiet.
All posting best-effort (4s timeout, errors swallowed, fast no-op when
unconfigured) — a dead webhook can never break a recompute. 79 tests.

**Discord architecture decision (2026-07-04): NO standing bot.** Three
touchpoints, three different machines: (1) webhook = announcements, built
above, zero infrastructure; (2) hub auth later = Discord *application* + OAuth,
plus a bot *token* used purely for server-side REST role lookups — still no
hosted process; (3) an interactive bot (/rankings from Discord) would be the
only thing needing more, can run serverless via an interactions endpoint, and
is NOT queued — build only if the team actually asks for it.

### Three-channel webhook routing + activity pings (round 15, 2026-07-04)

The single webhook grew into **three purpose-labelled slots** mapped to the
team's channels: `race` → #race-announcements (new eras · takeovers on tracks
with an upcoming race — the race calendar decides), `test` → #testdrivers
(session-logged pings · first-data flair · all other takeovers · new tracks
from a sync), `board` → #leader-board (badge/crown takeovers — slot live,
announcer queued). **Fallback:** an unconfigured slot posts to the first
configured one (race → test → board); the `race` slot keeps the original
setting key, so the already-connected webhook migrated untouched. New events:
**session logged** (POST /api/sessions only — edits/deletes silent; SVS read
back post-recompute) and **first data for a combo** (`RecomputeSummary.new_boards`
via pure `newBoardKeys`, tested). Control panel card = three slots, each
showing purpose, target channel, exact event routing, masked status, per-slot
save/disconnect/Test — the test message NAMES its feed. 82 tests.
**Channel-design decision:** banter feeds (#leader-board) stay OPEN so people
can reply; #race-announcements is the one worth locking read-only (webhooks
bypass channel send-permissions, so locking works).

### Data-quality flags (round 18, 2026-07-04)

Soft, non-blocking sanity checks for plausible-but-suspect inputs (typos,
dropped telemetry) — hard-impossible values stay in validation.ts. Pure module
`src/lib/quality.ts` (`sessionQualityWarnings`, 8 tests): best lap quicker than
the alien tier / slower than the offline tier (needs benchmark); no tyre wear
(≤1%) over a real stint (≥8 laps); lap-times count ≠ lap count; average >15%
slower than best over ≥5 laps. Wired both places from the one function: the log
form loads benchmarks, shows a live yellow "Sanity check" panel, and CONFIRMS on
submit ("log anyway?") rather than blocking; the session log shows a ⚠ per
suspect row with a tooltip. 94 tests. Verified live — even caught a real mislog
(a car logged as a Hypercar with GT3 pace). Benchmark resolved by car class +
track + condition (Dry fallback), matching scoreGroups.

### Briefing: multi-class weekend picks (round 17, 2026-07-04)

The briefing featured only ONE race (one class's car pick); other classes racing
the SAME weekend sat pick-less in "Upcoming". Now the featured card shows an
"Also racing this weekend" strip — for every other race sharing the featured
race's track + date, its top car per class (or "no ranked car yet"). Same-weekend
siblings are filtered out of the Upcoming list to avoid double-listing. Contained
change to `briefing/page.tsx` + CSS; verified live (Imola: LMP2 Oreca featured +
LMGT3 McLaren 80.3 beneath). Note: a wedged Fast-Refresh mid-edit showed a stale
compile error citing a line that didn't match disk — a preview server restart
cleared it (tsc was clean throughout).

### Driver-board badge announcer (round 16, 2026-07-04)

The third webhook channel now fires from a real event. `announceBadges()` (in
discord.ts, wired into `recomputeAll` after `announceFlips`) computes the
driver-board badges over the era-scoped sessions and diffs each badge's GOLD
holder vs a stored snapshot (`badge_gold_holders` setting). Pure tested helper
`diffBadgeGold(prev, badges)`: takeover only when a badge HAD a holder and it
changed; first-ever awards recorded silently (no early-data spam); unheld badges
dropped so a re-award doesn't false-fire. Always refreshes the snapshot (tracks
truth even with no webhook); posts a batched "Leader-board shakeup" only when
the board slot is reachable AND a crown moved (roast badges get banter
phrasing). Weight-change recomputes don't move badges (raw factor averages), so
no spam. 86 tests (4 new). **Verified live end-to-end:** primed the snapshot,
pushed "the possum" over the 5-session bar → flipped Fastest Overall (from
Pierre) + Tyre Killer (from Sam) in one #leader-board post. **All three webhook
channels now fire from real events** (rounds 14–16). The three round-15 loose
ends are all resolved: announcer built; #testdrivers session ping verified live
(harry's Aston run + first-data flair); all three channel URLs connected.

### Race start times in local timezone (round 19, 2026-07-04)

Race weekends carry an optional start time, stored as an absolute UTC instant
(`races.start_at`, TIMESTAMPTZ) and rendered in each viewer's OWN timezone via
`toLocaleString` — a UK manager sets 19:00, a German driver sees 20:00, no
per-user TZ setting. The add-race form has a "Start time (your local time)"
field; `new Date(\`${date}T${time}\`).toISOString()` pins the manager's local
wall-clock to UTC. Display: BLUF headline shows full local date+time + a "your
local time" hint; each same-weekend sibling class shows its own local start
time; Upcoming list shows local time by the countdown. start_at threaded through
types + both stores (Postgres additive migration in init() + schema; JSON via
spread) + races POST/PATCH (validated → UTC). Nullable — day-only races behave
as before. Verified live: Imola LMP2 15:30Z → 16:30 BST, GT3 18:00Z → 19:00 BST
here, 20:00 CEST for a simulated Berlin viewer. 94 tests.

### Coverage v2 — test requests (round 20, 2026-07-04)

The coverage map gained an action layer. A manager/admin clicks a cell to pin a
(car, track, condition) combo as "testing wanted": purple 📌 on the map, a
"Testing wanted" card on the briefing (race-week tracks ordered first), and a
#testdrivers webhook ("📋 Testing wanted: McLaren @ Sebring · Dry"). Cleared
from either surface. New `test_requests` entity (types + both stores: Postgres
table + additive init() migration + schema file; JSON store array/seq,
backward-compatible); POST de-dupes on the combo; DELETE by id. Role-gated (drivers
see 📌 read-only). Closes the loop between the coverage map and directing drivers.
Verified live (McLaren @ Sebring pin → ping → briefing → clear). 94 tests.

### Patch system — "era" reframed as the LMU patch (round 21, 2026-07-04)

The abstract "era" is now surfaced as the **patch** the team actually thinks in
(`version.patch.hotfix`, e.g. `1.3.4`). Eras table untouched; a current-patch
LABEL sits on top. `src/lib/patch.ts` parses/compares versions.
- **Phase 1 (commit 6eeda21):** `current_patch` setting + `/api/patch`; sessions
  auto-stamp `patch_version` from it (the dead column is now populated). Control
  panel "Current patch" card = version field + smart-defaulted "draw a
  comparability line" checkbox (`shouldDrawLineByDefault`: hotfix off / patch|
  version on, overridable) — ticking it creates an era via the existing flow.
  Global sidebar patch badge; status + rankings selector reworded era→patch
  (internals stay "era").
- **Phase 2 (commit 6ea2865):** the old ambiguous "Setup version" field ("1.3.3
  or GMR001") is now unambiguously **"Setup patch"**. A session whose setup patch
  is OLDER than its logged patch gets **depreciated Representativeness** (×0.7,
  `OLD_SETUP_REPRESENTATIVENESS_FACTOR`) → less weight in the car score, plus a ⚠
  flag at log time + in the session log. Comparison is self-contained
  (setup_version vs the session's own patch_version) so archived data isn't
  unfairly hit by later patches.
104 tests. Verified live end-to-end (set patch, auto-stamp, smart toggle
defaults, stale-setup flag + depreciation).

### Wet per-track penalty overrides (round 22, 2026-07-05)

The wet layer derived every track's Wet tiers from one global dry×(1+pct). Now
`deriveWetBenchmarks(store, pct, overrides)` takes a `{track_id: pct}` map
(setting `wet_penalty_overrides`) so circuits that deviate (Le Mans's long lap)
use their own %; everything else the global. /api/benchmarks/wet GET returns the
map, POST accepts `{penalty_pct?, overrides?}`. Control-panel "Wet pace penalty"
card grew a "Per-track overrides" section (inline edit + add/remove). Verified
live: Le Mans +12% → wet=dry×1.12, Spa +8% → dry×1.08. Left a realistic Le Mans
override in place.

### Scoring transparency + post-briefing-to-Discord (round 23, 2026-07-05)

Both gated to **Team Manager + Admin** (user's explicit call — flip the
`role !== "driver"` checks if drivers should ever see the scoring page).
- **#how-scoring-works (`/scoring`)**: five factors with real weights/mechanics,
  SVS components, n/(n+1) confidence, patch/benchmark/guardrail rules — must be
  kept in sync with scoring.ts constants when they change. Sidebar link added
  under Engineering for manager/admin; drivers get a lock state. The session
  log's SVS column now shows a per-session component-breakdown tooltip
  (manager/admin).
- **POST /api/races/:id/announce + "📢 Post briefing to Discord"** (briefing
  manager row): server-composed BLUF (when, per-class picks incl. same-weekend
  siblings, engineer's note, weighting) → #race-announcements. Uses Discord
  `<t:…:F>` timestamps so readers see their own local time. The manual button
  covers the race-week reminder use-case without a scheduler.
Verified live incl. a real post ("✅ Posted to #race-announcements"). 104 tests.

### 🔭 Action points — queued, not yet built (most recent first)

- **Stint-planner bridge (agreed 2026-07-04 — deliberately DEFERRED).** The
  Tauri app already captures lap times/tyre wear/off-tracks live; a "log this
  session to CCR platform" button POSTing to the existing API would kill manual
  entry and typos. BOTH apps must stabilise first — building it now risks
  breaking both. Revisit when the stint planner's feature work settles.
- **Production data store (release gate, flagged 2026-07-04).** Netlify runs the
  app as serverless functions with an ephemeral, read-only filesystem — the
  zero-config JSON store CANNOT persist writes there (session logs, benchmark
  sync, eras, wet penalty all vanish on cold start). Before any real release,
  wire a **Postgres `DATABASE_URL`** (the store auto-selects it) and run the
  init migrations, then end-to-end write-test (log a session → survives refresh
  + a cold start). Tested on Netlify 2026-07-04 and "looks good" — but that was
  the read path; persistence is unconfirmed. `netlify.toml` / `DEPLOY.md` have
  the setup notes.
- **Auth hub** (release gate) — provider-agnostic identity + server-enforced
  roles; likely a separate Cloudflare hub. Everything ships behind this.
- **GT3-wheel control-panel styling (LOW PRIORITY — user demoted 2026-07-05).**
  Dress the functional panel with `public/steering-wheel-logo.png` (static-first).
  User's read: "more of a gimmick than anything else" and concerned the concept
  won't translate from brain to real life — keep queued, do last, don't push it.

### Wet benchmarks (derived, admin-tunable) + driver weighting (round 11, 2026-07-03/04)

**Wet benchmarks are DERIVED, not sourced** (the sheet is dry-only): every Wet
tier = dry × (1 + penalty/100). Penalty defaults to **8%** (LMU dry→wet loss
~5–10%; Le Mans 3:30 lap ≈ 15–25s ≈ 7–12%), stored in setting `wet_penalty`,
**admin-tunable in the control panel** ("Wet pace penalty" card).
- `deriveWetBenchmarks(store, pct)` in `benchmark-sync.ts` rebuilds all Wet rows
  from current Dry (upsert-keyed on track/class/Wet — no stale rows); wet rows
  tagged `patch_version` "<dry> (wet +N%)".
- `GET/POST /api/benchmarks/wet` (penalty read / set 0–30 → regenerate +
  recompute); api-client `wetPenalty()`/`setWetPenalty()`.
- A **dry sync now also regenerates wet** at the stored penalty, so wet tracks
  fresh dry data. Scoring unchanged — wet sessions already look up a
  (track,class,Wet) benchmark (Dry fallback stays for Mixed etc.).
- Per-track hand-tuning of wet is a future layer; this is a uniform global %.
- Verified: 290 benchmarks (145 Dry + 145 Wet), Spa LMGT3 wet alien 2:28.09 =
  dry 2:17.12 × 1.08 exact.

**Driver can switch the weighting preset (but not edit raw weights).**
`WeightsControl` gate renamed `canEditRaw` (role !== "driver"): everyone gets
the preset dropdown; the "Custom…" option + ⚙ slider editor are manager/admin
only. A driver viewing a manager-set Custom weighting sees it as a disabled
option and can still pick a preset. NOTE: weighting is global/shared, so a
driver's preset change applies to everyone + recomputes (consistent with the
existing model; revisit if per-user views land with auth).

### Benchmark sync now works — keyless public CSV + auto-create tracks (round 10, 2026-07-03)

**The "Sync from Ohne Speed" button was dead and mis-calibrated; now it works
with zero config.** Two problems fixed:
- It was gated on `GOOGLE_SHEETS_API_KEY`/`GOOGLE_SHEETS_ID` env vars (never
  set) → silently kept seed data. And the parser (calibrated offline on a saved
  HTML copy) read tier columns 4–9, but the **live** grid has them at
  3/4/5/7/9/10 — so it would have produced garbage even with keys.
- Fix: the Ohne Speed sheet is **published-to-web (public)**, so we read the
  **keyless CSV export** of the master tab — no API key, no secret. The button
  just works.

**Ohne Speed sheet reference (so nobody has to re-decode it):**
- Published-doc id: `2PACX-1vTN03UvJDm99byA6vQPZHKOCYVvfxLu1zkJAzdaKyROykzEKY2-Xl1rl1q5znZEf36m88dxMKsY2eaO`
  (hardcoded default, override via `OHNE_SPEED_PUBLISHED_ID`).
- Master laptimes tab **gid `1766901750`** (override via `OHNE_SPEED_GID`). The
  doc has 42 tabs; this is the one with the all-class benchmark grid.
- CSV URL: `https://docs.google.com/spreadsheets/d/e/<id>/pub?output=csv&gid=<gid>`.
- **Live layout:** per-class grid; each data row col0 = "<track><CLASS>" (e.g.
  "SpaLMGT3"), col1 = track, col2 = patch, tiers at cols **3/4/5/7/9/10** =
  Alien / Competitive / Good / Midpack / Tail-ender / Offline (the sheet's own
  labels; the 103%/105% columns are unlabelled → skipped). All rows Dry.
- Class from col0's suffix after the track string. GTE rows skipped.

**Auto-create tracks:** matching is **exact-normalized only** now — the old
fuzzy/contains match would collapse layout variants ("Bahrain (wec)" →
"Bahrain") onto one track and clobber each other's benchmarks. A genuine miss
creates the track, so a new circuit/layout on the sheet flows straight through.
`SyncResult` gained `tracks_created`; a minimal RFC-4180 CSV parser was added.

**Verified live:** pulled 145 rows (29 tracks × 5 classes, all Dry), 0 tracks
created (all existed), tiers exact vs the sheet (Spa LMGT3 alien 2:17.12 →
offline 2:26.07). Seed placeholders replaced with real data. **Wet benchmarks
stay a separate derived layer (dry × 5–10% penalty) for later — this is the dry
source-of-truth pull.**

### "Test" session type dropped + representativeness recalibrated (round 9, 2026-07-03)

**Rooted in the data-collection reality: drivers run dedicated TESTS (in
Practice sessions), never real races.** Two linked changes:

- **`SessionType` is now `Practice | Quali | Race`** — "Test" removed (in LMU,
  testing *is* a Practice session, so it was a redundant label). Form defaults
  to Practice. No data migration: the representativeness lookup falls back to
  100 for any unknown/legacy type, so old "Test" rows still score (and never
  NaN).
- **SVS `representativeness` recalibrated so testing isn't self-penalised.** Old
  map was a race-weekend model (Race 100 > Quali 85 > Test 70 > Practice 60) —
  but with every session a Practice test, that sub-score sat pinned at the low
  end for everyone, dragging all SVS/confidence down uniformly *and* not
  discriminating. New map: **Practice 100** (the primary source), Race 100,
  Quali 90 (pure hotlap slightly less representative of stint pace). The
  hotlap-vs-long-run signal is carried by `completeness` (lap count), not this
  tier. Dry/Wet/Mixed condition multiplier unchanged (benchmark sheet is Dry).
- **Soft weather-vs-setup hint** on the log form (non-blocking amber note): if
  the chosen setup's trim clashes with logged weather (Wet setup in the Dry, or
  a dry setup in the Wet). Cross-testing is legit → never blocks submit.

2 new SVS tests (72 total).

### Controlled setup-type dropdown (round 8, 2026-07-03)

**The free-text "Setup version" field became a fixed 7-item dropdown + a
separate optional version field.** Problem it solved: free text let the same
setup be named "Enduro 1" one time and "Endurance" the next, which fragmented
best-setup grouping into separate sub-buckets that each then failed the ≥3-run
threshold — quietly defeating round 6. The 7 types are a controlled enum
(`SETUP_TYPES` in `types/index.ts`), a purpose (Quali/Race/Endurance) × trim
(Esport/Safe/Wet) matrix taken from the setup provider's own convention.
**Confirmed against two sources:** the documented codes (E R, E Q, S R, S Q,
WET R, WET Q, Endu) *and* the real `.svm` filenames (`R Esport`, `Q Safe`,
`Endu Esport`…) — same 7. Note the real files **drift from the documented
convention** (`GO 1.3.3 GMR001 HYP IMO R Esport` vs the doc's `GO4 AMR LMGT3
BRN E R01`), which is exactly why we capture structured parts and never match
on the filename string. Stored as the readable label ("Race · Esport"); the
provider shorthand shows in the dropdown.

**`setup_version` stays free text but changed meaning** — it's now the
pack/game version the driver ran (`1.3.3`, `GMR001`), not the setup identity.
Captured now, interpreted later: the data must exist before any staleness/
currency flag can be built on it, and the version strings drift too much to
structure. Deliberately NOT a score penalty yet — an old setup isn't a slower
car, and there are already two currency mechanisms (SVS recency + eras); a
future "latest per setup line" *flag* (derived from logged data, not the global
game version — releases are staggered) is the planned use.

**best-setup grouping** now keys off `setup_type` when present (all versions of
"Race · Esport" group as one setup line), falling back to legacy free-text
`setup_version` for pre-dropdown sessions — round-6 behaviour and existing data
untouched. Full stack: `setup_type` on Session/SessionInput/NewSessionRecord;
validation whitelists against `SETUP_TYPES` (bogus values silently dropped);
Postgres column + additive migration; JSON store; both session routes; the
session-log table shows type + version. 2 new tests (70 total). Verified
end-to-end (valid type round-trips, bogus dropped to null).

### Driver leaderboard (round 7, 2026-07-03)

**Friendly cross-driver competition — badges + charts, no role gating.** New
`/drivers` page ("driver-board" in the sidebar, its own "Leaderboard" section).
Reuses the exact same per-session factor scores the car rankings use
(`scoreSession`), just aggregated by `driver_id` across every car/track/
condition a driver has logged instead of by `(car, track, condition)` —
the factors are already benchmark-normalised 0–100 so a driver's GT3 laps at
Le Mans and LMP2 laps at Spa are directly comparable with no new scoring math.
New `src/lib/driverAnalytics.ts`: `computeDriverStats` (SVS-weighted averages
per driver, same weighting principle as car aggregation) + `computeBadges`.

**Badge catalog** — top 3 per badge get gold/silver/bronze, gated behind
`MIN_SESSIONS_FOR_BADGE` (=5, tunable const in scoring.ts) except Iron Man
(session count *is* the metric, gating it would be circular): Fastest Overall
(pace), Mr/Mrs Consistent, Tyre Whisperer, All-Rounder (smallest spread across
a driver's own 5 factor averages — no weak spot), Iron Man (most sessions
logged) on the positive side; **Tyre Killer** and **Lawn Mower** (most
off-tracks) on a separate "Roast wall" card — same underlying numbers, worst
end of the scale, for laughs.

**Three hand-rolled inline-SVG charts** (no new dependency, on-brand CSS vars):
a sessions-logged bar chart, a consistency-over-time line chart overlaying the
top 5 most-active drivers, and per-driver tyre-wear ring gauges (green/amber/
red). Read-only, ad-hoc (`/api/driver-stats`, no persistence), scoped to the
current era like the live rankings board. **V1 is "overall" only** (all cars/
tracks/conditions blended per driver) — per-track/per-car drill-down was
explicitly deferred until the overall badges prove which ones people actually
care about. 9 tests in `driverAnalytics.test.ts` (68 total). Verified live
with 3 seeded drivers across all 7 badges + both roast entries + all 3 charts.

### Best-setup scoring (round 6, 2026-07-02)

**A car is ranked by its BEST qualifying setup, not a blend of everything tried.**
Inside `scoreGroups`, each (car, track, condition) bucket is sub-grouped by
`setup_version` (trimmed; blank = one "unspecified" bucket). A setup qualifies
once it has ≥ `MIN_SESSIONS_PER_SETUP` (=3, tunable const in scoring.ts) runs;
among qualifiers, each setup's latest `SCORING_WINDOW` runs are aggregated and
the **highest Car Score wins** (the score is already race-weighted, so the winner
is the best race package, not a hot-lap). Rationale: blending punishes thorough
testing — a car you tried 4 setups on gets dragged down by the 2 duds you've
since abandoned. Guard against max-of-noise = the ≥3 threshold. **Fallbacks keep
it harmless:** if no setup clears the bar (thin data, or all runs on one <3-run
setup), it blends the bucket's latest `SCORING_WINDOW` = exact pre-feature
behaviour; blank/untagged setups collapse to that same blend. The winning
`setup_version` is stamped on the recommendation (`best_setup`, null when
blended/unspecified) and shown as a "setup …" tag under the car on the board;
`sessions_used`/`confidence` reflect the winning setup's runs only. SVS is now
computed for every in-range session (per-session quality, setup-independent), not
just the windowed ones. Store: `best_setup` on recommendations (JSON flows via
spread; Postgres column + additive migration). 5 tests in `recompute.test.ts`.
Verified in-game-shaped: 3 faster "Aero B" runs flipped the Ferrari from
"Basic V2" 88.2 → "Aero B" 95.2 (using only the 3 winning runs), reverted on
delete.

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
