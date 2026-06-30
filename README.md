# CrossCurrent Racing — Data Analysis Platform

**A deterministic, data-driven car-to-track recommendation engine for Le Mans Ultimate endurance racing.**

---

## Vision

Before race day, engineers need to pick the right car (Porsche 992? Ferrari 296? Toyota GR010?) for a given track, weather condition, and driver skill level. This platform analyzes logged test sessions and provides **explainable, mathematical rankings** so the choice is driven by data, not gut feel.

Input: driver logs a 12-lap test session (lap times, tyre wear, off-track count, setup version, confidence).  
Output: car rankings per track/class, with a 5-factor breakdown (pace, consistency, tyre wear, drivability, mistake-proneness) + confidence score.

---

## Status

**Phase 1 (MVP):** Design locked, implementation starting.

- ✅ Full scoring specification
- ✅ Database schema (PostgreSQL)
- ✅ API endpoint design
- ⏳ Next: Next.js scaffold + session logging form + scoring engine

---

## Quick Start

**Local dev needs no database.** When `DATABASE_URL` is unset the app uses a
zero-config JSON store at `.data/store.json` (gitignored). Set `DATABASE_URL`
to switch to PostgreSQL — same engine, same UI, nothing else changes.

```bash
# 1. Install
npm install

# 2. Run the dev server (no DB required)
npm run dev

# 3. Open http://localhost:3000
#    → click "Load sample data" in the banner to populate cars/tracks/benchmarks
#      (or, with the server running, `npm run seed` in another terminal)
```

### With PostgreSQL (production / Netlify)

```bash
# Create the schema once
psql "$DATABASE_URL" -f db/1_init_schema.sql

# Then run with DATABASE_URL set — the app auto-detects it
DATABASE_URL=postgres://… npm run dev
```

> **Stack note:** this is **Next.js (App Router) + React 19 + TypeScript** with
> Next.js API route handlers. Next.js uses its own bundler — there is no Vite in
> this app (the original spec's "Vite" mention was a slip). Deployment is Netlify
> via `@netlify/plugin-nextjs`.

---

## Project Structure

```
ccr-platform/
├── CLAUDE.md                    # Instructions for Claude Code
├── README.md                    # This file
├── SPEC.md                      # Full design specification
├── SCHEMA.md                    # Database schema + migrations
├── crosscurrent_racing_spec.md  # Original v1.0 spec (reference)
├── src/
│   ├── app/                     # Next.js app directory
│   │   ├── page.tsx            # Dashboard (rankings)
│   │   ├── log/                # Session logging form
│   │   ├── api/
│   │   │   ├── sessions/       # CRUD endpoints
│   │   │   ├── rankings/       # Scoring & recommendation endpoints
│   │   │   ├── benchmarks/     # Benchmark sync & fetch
│   │   │   └── metadata/       # Cars, tracks, drivers
│   │   └── layout.tsx          # Root layout
│   ├── components/
│   │   ├── SessionForm.tsx     # Session logging form
│   │   ├── RankingsTable.tsx   # Rankings display
│   │   ├── FactorBreakdown.tsx # 5-factor detail view
│   │   └── ExportButton.tsx    # JSON/CSV export
│   ├── lib/
│   │   ├── db.ts               # PostgreSQL client
│   │   ├── scoring.ts          # Scoring engine (5 factors, aggregation)
│   │   ├── benchmark-sync.ts   # Google Sheets API sync
│   │   └── validation.ts       # Input validation
│   └── types/
│       └── index.ts            # TypeScript types (Session, Car, Recommendation, etc.)
├── db/
│   └── 1_init_schema.sql       # PostgreSQL migrations
├── .env.example                # Environment variables template
├── .gitignore
├── package.json
├── tsconfig.json
└── next.config.js
```

---

## Key Features (MVP Phase 1)

### 1. Session Logging
- Driver fills out form: driver name, car, track, lap times, tyre %, off-tracks, confidence, setup version
- Form validates (best lap < avg lap, tyre % in range, etc.)
- Data persists to PostgreSQL (not localStorage)

### 2. Scoring Engine
Five factors per session:
1. **Pace (35%):** Best lap vs. "Ohne Speed" benchmark tiers
2. **Consistency (25%):** Lap-to-lap variance relative to average time
3. **Tyre wear (15%):** Average % wear across 4 tyres + uniformity
4. **Drivability (15%):** Driver's confidence rating (1-10)
5. **Mistakes (10%):** Off-track count normalized to laps completed

Factors are weighted by **Session Value Score** (quality of the session) when aggregating into a Car Score.

### 3. Rankings Dashboard
- Select track + class (LMGT3, LMH, LMP3, LMP2)
- View cars ranked by Car Score
- See 5-factor breakdown, sessions used, confidence score

### 4. Detail Views
- Click a car → see all contributing sessions
- Click a session → see individual 5-factor scores
- Spot patterns (e.g., "Ferrari wears tyres 50% harder than Porsche")

### 5. Benchmark Sync
- Daily automated sync from "Ohne Speed" Google Sheets
- Fallback to cached data if API fails
- Admin can manually trigger refresh or upload CSV

### 6. Export
- JSON: full detail (all sessions, all factors)
- CSV: summary rankings (for sharing with drivers)

---

## Data Model (Quick Reference)

| Table | Purpose |
|-------|---------|
| `drivers` | User profiles (name, role, trust score in Phase 2) |
| `cars` | Car models (Porsche 992, Ferrari 296, etc.) |
| `tracks` | Race circuits (Le Mans, Spa, Imola, etc.) |
| `sessions` | Logged test sessions (lap times, off-tracks, setup) |
| `tyres` | Per-session tyre wear (FL, FR, RL, RR %) |
| `benchmarks` | Cached "Ohne Speed" pace tiers (synced daily) |
| `recommendations` | Computed car scores (regenerated when sessions are added) |

See `SCHEMA.md` for full details.

---

## API Endpoints (MVP Phase 1)

### Sessions
- `POST /api/sessions` — Log a new session
- `GET /api/sessions` — List sessions (filtered)
- `GET /api/sessions/:id` — Get session detail
- `PUT /api/sessions/:id` — Update session
- `DELETE /api/sessions/:id` — Delete session

### Rankings
- `GET /api/rankings` — List car scores (filtered by track, class, condition)
- `GET /api/rankings/:carId/:trackId` — Get specific car-track score
- `POST /api/rankings/recompute` — Trigger scoring engine

### Benchmarks
- `GET /api/benchmarks` — List all benchmark tiers
- `GET /api/benchmarks/:trackId/:class` — Get tiers for track/class
- `POST /api/benchmarks/sync` — Manually trigger Google Sheets sync

### Metadata
- `GET /api/cars` — List all cars
- `GET /api/tracks` — List all tracks
- `GET /api/drivers` — List all drivers

---

## Environment Variables

Create `.env.local`:

```env
# Database (Netlify Postgres or external)
DATABASE_URL=postgres://user:password@localhost:5432/ccr_platform

# Google Sheets (benchmark sync)
GOOGLE_SHEETS_API_KEY=<your-api-key>
GOOGLE_SHEETS_ID=1vTN03UvJDm99byA6vQPZHKOCYVvfxLu1zkJAzdaKyROykzEKY2-Xl1rl1q5znZEf36m88dxMKsY2eaO

# Next.js
NEXT_PUBLIC_API_URL=http://localhost:3000
NODE_ENV=development
```

---

## Roadmap

### Phase 1: MVP (Core App) — Weeks 1–4
- [ ] Next.js scaffold + Tailwind CSS
- [ ] PostgreSQL setup (local dev, Netlify for prod)
- [ ] Database migrations
- [ ] Session logging form (frontend + API)
- [ ] Scoring engine (5 factors + aggregation)
- [ ] Rankings dashboard
- [ ] Session detail view + 5-factor breakdown
- [ ] Benchmark sync (Google Sheets API)
- [ ] JSON/CSV export
- [ ] Basic validation & error handling
- [ ] Deploy to Netlify

**Success:** 10+ sessions logged, rankings computed, no bugs on sample data.

### Phase 2: Auth & Admin (Weeks 5–7)
- [ ] Discord OAuth integration
- [ ] User roles: driver, engineer, admin
- [ ] Admin trust system (hidden weighting on contributions)
- [ ] Admin override logging & audit trail
- [ ] SVM setup file parsing (extract TC, ABS, brake bias, etc.)
- [ ] Patch versioning decay weighting

**Success:** Multi-user login, admin can trust/distrust drivers.

### Phase 3: Advanced (Weeks 8+)
- [ ] Machine learning: setup-to-performance correlations
- [ ] Predictive pit strategies (fuel/tyre projections)
- [ ] Setup recommendations ("try increasing brake bias 3%")
- [ ] Cloud-descriptor calibration (sync with live telemetry if available)
- [ ] Native tray app (Electron or Tauri; optional)
- [ ] SQLite persistence for offline mode
- [ ] Mobile app (React Native; optional)

---

## Scoring Formula (Quick Reference)

```
car_score = 
  pace_factor × 0.35 +
  consistency_factor × 0.25 +
  tyre_factor × 0.15 +
  drivability_factor × 0.15 +
  mistakes_factor × 0.10

Each factor is 0–100, weighted by session quality (Session Value Score).
Confidence score is (session_count / 10) × (avg_session_quality / 100).
```

See `SPEC.md` § 3 for full formulas.

---

## Known Unknowns (Phase 2+)

- **Session Value Score weighting:** Components (completeness, consistency, cleanliness, representativeness, recency) need real testing.
- **Patch decay curve:** How old should data be before it's ignored?
- **Trust system multiplier:** How much do we downweight low-trust drivers?
- **SVM parameter correlation:** Which setup params affect pace/tyre wear most?
- **Multi-driver aggregation:** How to handle different driver skill levels fairly?

---

## Contributing

1. Create a branch: `git checkout -b feature/my-feature`
2. Commit: `git commit -m "Add feature"`
3. Push: `git push origin feature/my-feature`
4. Open a pull request

---

## Support

Questions or issues? See:
- `CLAUDE.md` — Project instructions
- `SPEC.md` — Full design + scoring formulas
- `SCHEMA.md` — Database structure + migrations
- Original spec: `crosscurrent_racing_spec.md`

---

## License

Internal — Crosscurrent Racing team only.

