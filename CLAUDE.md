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

### Three pragmatic build decisions (not in the original spec — flag if revisiting)

1. **Dual store (idiot-proof local dev):** Postgres when `DATABASE_URL` is set
   (production/Netlify, per the locked design), else a zero-config JSON store at
   `.data/store.json`. Same engine/UI either way. Docker isn't installed on this
   machine, so requiring Postgres to test locally would have blocked the manual
   feedback loop.
2. **Consistency = best→avg gap proxy.** SPEC §3.2 wants std-dev of every lap, but
   the form (SPEC §5.1) logs only best + average + count. So `consistency =
   100×(1 − (avg−best)/avg)`. On long laps this barely differentiates cars (all
   ~99) — a known limitation; swap in `consistencyFactorFromLaps()` once full lap
   arrays are captured. Differentiation currently comes from pace/tyre/mistakes.
3. **Seed benchmarks are placeholders** (`patch_version = "seed"`, readiness 25%):
   approximate per-track LMH alien times × class/tier multipliers, so pace scoring
   works out of the box. Replaced by the first successful Google Sheets sync (the
   Ohne Speed tab/column mapping still needs calibration against the live sheet).
