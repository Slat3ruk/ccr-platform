# Design Decisions — CrossCurrent Racing Platform

**Status:** Locked (Grilled with user 2026-06-30)  
**Process:** Interactive grill-me session to reach shared understanding

---

## Scoring Model

### Factors & Weights
| Factor | Weight | Formula |
|--------|--------|---------|
| **Pace** | 35% | Best lap vs. benchmark tiers (Alien/Competitive/Good/Midpack/Tail-ender/Offline) |
| **Consistency** | 25% | Lap-to-lap variance relative to avg time: `100 × (1 − std_dev ÷ avg_laptime)` |
| **Tyre Wear** | 15% | Average % wear across 4 tyres + uniformity penalty |
| **Drivability** | 15% | Driver's confidence rating (1-10 slider) × 10 = score |
| **Mistakes** | 10% | Off-track count normalized to expected max (~3 per 10-15 laps) |

**Aggregation:** Per-car-per-track, latest 10 sessions, **weighted by Session Value Score** (quality of each session).

**Final Score:** `car_score = (pace×0.35) + (consistency×0.25) + (tyre×0.15) + (drivability×0.15) + (mistakes×0.10)`

**Confidence:** `(session_count / 10) × (avg_session_value / 100)` — 0–1 scale.

---

## Data Inputs & Validation

### Session Logging
Driver inputs (one-by-one, no bulk import for MVP):
- Driver name (text)
- Car (dropdown, pre-seeded + admin-addable)
- Track (dropdown, pre-seeded + admin-addable; supports layouts)
- Session type (Practice / Quali / Race / Test)
- Weather (Dry / Wet / Mixed)
- Lap count (int, >0)
- Best lap time (MM:SS.mmm)
- Avg lap time (MM:SS.mmm; must be ≥ best lap time)
- Tyre % remaining (FL, FR, RL, RR; 0-100 each)
- Off-track count (int, ≥0)
- Confidence rating (1-10 slider)
- Setup version (string, optional; e.g., "Basic V2 Quali")
- SVM file (optional, Phase 2; setup parsing)
- Comments (free text)

**Validation:** Input sanitization, range checks, lap time logic (best ≤ avg).

---

## Benchmark Data

**Source:** "Ohne Speed" LMU Laptimes spreadsheet (public Google Sheets)

**Sync Strategy:**
- ✅ Automated daily via Google Sheets API
- ✅ Fallback to cached data if sync fails (don't break rankings)
- ✅ Admin can manually trigger refresh
- ✅ Admin can upload CSV as backup

**Data Cached:**
- Track, class (LMGT3 / LMH / LMP3 / LMP2-ELMS / LMP2-WEC)
- Condition (Dry / Wet / Mixed; or per-track variants)
- Pace tiers: Alien, Competitive, Good, Midpack, Tail-ender, Offline (lap times)
- Data readiness % (confidence in the tier)
- Patch version (for decay weighting, Phase 2)

---

## Session Value Score (Weighting)

**Purpose:** Weight each session's contribution to the Car Score. High-quality sessions pull average up; low-quality sessions have less influence.

| Component | Weight | Criteria |
|-----------|--------|----------|
| **Completeness** | 30% | Lap count ÷ typical stint (12-15 laps). Full at 15+, decay <10. |
| **Consistency** | 25% | Lap-to-lap variance (tight = high). Same calc as Consistency Factor. |
| **Cleanliness** | 20% | Off-track count. 0 OTs = 100; penalize with OT count. |
| **Representativeness** | 15% | Session type (Race/Quali > Practice/Test) + condition match. |
| **Recency** | 10% | Days since session. Fresh (<7 days) = high; old (30+ days) = decay. |

**Aggregation:** `svs = (completeness×0.30) + (consistency×0.25) + (cleanliness×0.20) + (representativeness×0.15) + (recency×0.10)` → 0-100 score.

---

## Specific Formula Decisions

### Consistency Factor
```
std_dev = standard_deviation(all_lap_times)
avg_lap = average(all_lap_times)

consistency_score = 100 × (1 − (std_dev ÷ avg_lap))

Rationale: Scales variance relative to lap time, so a 2s variance on a fast lap 
(3:47 = 227s) isn't catastrophic. Soft curve (not 0.5s = 50/100).
```

### Tyre Factor
```
avg_wear_pct = 100 − avg([FL%, FR%, RL%, RR%])
tyre_uniformity = 100 − std_dev([FL%, FR%, RL%, RR%])

tyre_score = (100 − avg_wear_pct) × 0.6 + tyre_uniformity × 0.4

Rationale: Rewards low wear (strategy advantage) + uniform wear 
(setup quality + driver smoothness). Harsh drivers show uneven wear.
```

### Mistakes Factor
```
laps_completed = session.lap_count
expected_ot_max = (laps_completed ÷ 12.5) × 3  [normalized to 10-15 lap range]

mistakes_score = max(0, 100 − (off_track_count ÷ expected_ot_max × 100))

Rationale: ~3 OTs per 10-15 laps is acceptable (race-paced testing). 
Over that = handling/setup issues. Scales with lap count (doesn't penalize short sessions).
```

### Pace Factor
```
Tiers from benchmark: alien_time, competitive_time, good_time, midpack_time, tail_ender_time

if driver_best_lap < alien_time:
  pace_score = 100
elif driver_best_lap < competitive_time:
  pace_score = 95
elif driver_best_lap < good_time:
  pace_score = 85
elif driver_best_lap < midpack_time:
  pace_score = 70
else:
  pace_score = 50 − ((driver_best_lap − midpack_time) / (tail_ender_time − midpack_time) × 30)
  pace_score = max(0, min(50, pace_score))

Rationale: Linear interpolation between tiers. Precise formula TBD based on data distribution.
```

---

## Aggregation Window & Weighting

**Window:** Latest 10 sessions per car-track combo.

**Weighting:** Each session's 5 factors are weighted by that session's Session Value Score before averaging.

```
For each session i in [1..N]:
  pace[i], consistency[i], tyre[i], drivability[i], mistakes[i] = 5 factors
  svs[i] = session value score (0-100)

pace_final = Σ(pace[i] × svs[i]) ÷ Σ(svs[i])
[repeat for all 5 factors]

car_score = (pace_final × 0.35) + (consistency_final × 0.25) + ...
```

**Rationale:** Quality sessions (high SVS) pull the average up. Low-quality sessions have less influence. Mathematically optimal for mixed driver/condition data.

---

## Tyre Wear Modeling

**Approach:** Comparative, no absolute benchmark.

**Why:** No "ideal" wear rate exists per car-track combo (varies by fuel load, setup, driver style, condition). Compare drivers/cars instead.

**Example:** Ferrari wears tyres 50% faster than Porsche on Le Mans → Ferrari is harsher, needs more pit stops → strategic consideration.

**Future (Phase 2+):** Correlate wear with setup parameters (SVM) to diagnose "harsh on tyres" issues.

---

## Off-Track Incident Handling

**Metric:** Off-track count (not LMU penalty points; those are race-specific).

**Why:** OTs indicate handling/stability problems. High OTs = car/setup made it hard to drive.

**Threshold:** Max ~3 OTs per 10-15 laps acceptable for training sessions. Beyond that = problematic for race (would accumulate penalties).

**Scaling:** Normalized to lap count, so 3 OTs in 5 laps = major failure; 3 OTs in 20 laps = acceptable.

---

## Real-Time Updates

**Requirement:** Dashboard auto-refreshes when driver logs new session.

**MVP Implementation:** Polling (dashboard checks for new rankings every 5 seconds).

**Rationale:** Simpler than WebSocket, works well for MVP. Admin + engineer see rankings update live.

**Future (Phase 2+):** WebSocket for instant push-to-client if needed.

---

## Cars & Tracks Data Management

**Initial Seed:** All cars + tracks from "Ohne Speed" spreadsheet pre-populated on first run.

**Cars:** GT3 (Porsche, Ferrari, Cadillac, Lamborghini, etc.), LMH (Toyota, BMW, Genesis, etc.), LMP3, LMP2.

**Tracks:** 20+ (Le Mans, Spa, Imola, Bahrain, COTA, Fuji, Portimao, Qatar, Silverstone, Sebring, Paul Ricard, Monza, etc.) with layout variants (e.g., Le Mans straight, Le Mans chicane).

**Admin Add New:** Simple form to add car/track (Phase 1 or 1.5, after MVP core is working).

**Rationale:** Drivers must have pre-populated options to pick from; admin can extend list as new cars/tracks are tested.

---

## UI/UX Design

**Style:** Discord-inspired (dark theme, clean, modern, accent colors).

**Components:**
- Session logging form (clean inputs, confident dropdowns, tyre wear as 4 sliders)
- Rankings dashboard (sortable table, 5-factor columns, confidence score)
- Session detail view (all factors, contributing sessions, tyre wear patterns)
- Export button (JSON + CSV)

**Rationale:** Discord is trusted, modern, approachable. Drivers won't be intimidated. Engineers will find depth when needed.

---

## Testing Strategy

**Approach:** Manual testing only for MVP.

**Process:**
1. Build → deploy to the VPS (subdomain of the team website)
2. User + beta testers manually log sessions, check rankings
3. **Feedback document** listing bugs, UI issues, feature requests
4. I read feedback doc → fix/improve → iterate

**No automated tests (E2E, unit tests) for MVP.** Adds complexity, slows development. Manual testing + user feedback is sufficient.

**Rationale:** MVP is about proving the scoring engine works + UX is usable. Automation can come later (Phase 2+).

---

## Deployment Strategy

**LOCKED (2026-07-08): self-hosted VPS, apps as subdomains of the team website.**
(An earlier serverless-MVP hosting plan was dropped.) The team website is the
auth hub, apps live on subdomains of its domain, so hosting stays on one VPS.

- **Host:** a VPS running the Next.js app (persistent Node process) + Postgres on
  the same box. Reverse proxy (Caddy → auto-HTTPS) routes subdomains.
- **This app:** `data.crosscurrentracing.com`; the team website at the apex.
- **Auth:** the website does Discord OAuth and sets a cookie scoped to the parent
  domain; the app (a subdomain) receives it and just verifies (see the ⭐ release
  plan in CLAUDE.md). Replaces the client-side view-as toggle.
- **Data:** real filesystem + real Postgres, so the JSON dev store's ephemeral
  limitation never applies in production.

**Rationale:** one box, one domain, one Discord sign-in across every app; full
control, no serverless-disk persistence problem, no per-app auth.

---

## Authentication & Admin (Phase 2)

**MVP (Phase 1):** No auth. Anyone can log sessions. (Suitable for internal testing only.)

**Phase 2:** Discord OAuth + RBAC
- Drivers: log sessions only
- Engineers: log + view detailed breakdowns + access admin tools
- Admins: full access + trust scoring + overrides

**Trust System (Phase 2):** Hidden admin-only score (0-1 multiplier) affecting weighting of contributions. E.g., low-trust driver's sessions weight 50%; high-trust driver's sessions weight 100%.

**Rationale:** Phase 1 is trusted team only. Phase 2 adds formal auth when expanded.

---

## Known Unknowns (Phase 2+)

- **Session Value Score fine-tuning:** Real data might show weights need adjustment (e.g., Representativeness should be 25% not 15%).
- **Patch decay curve:** How old should data be before it's ignored? Exponential? Linear? TBD.
- **Trust multiplier formula:** How much downweight low-trust drivers? 0.5? 0.7? Need data.
- **SVM parameter correlation:** Which setup params correlate with pace/tyre wear? Requires analysis.
- **Multi-driver aggregation:** How to fairly compare drivers of different skill levels? Baseline normalization? Rating system?

---

## Decision Log

| Date | Decision | Locked By |
|------|----------|-----------|
| 2026-06-30 | 5-factor scoring model (Pace 35%, etc.) | Grill session |
| 2026-06-30 | Aggregation: per-car-per-track, latest 10 sessions, weighted by SVS | Grill session |
| 2026-06-30 | Consistency formula: `100 × (1 − std_dev ÷ avg_lap)` | Grill session |
| 2026-06-30 | Tyre wear: comparative, no benchmark; uniformity penalty | Grill session |
| 2026-06-30 | Mistakes: max ~3 OTs per 10-15 laps; normalized to lap count | Grill session |
| 2026-06-30 | Benchmark sync: daily automated, fallback to cache, admin manual | Grill session |
| 2026-06-30 | Session Value Score: weights each session (Completeness 30%, etc.) | Grill session |
| 2026-06-30 | Real-time: polling (auto-refresh dashboard every 5s) | Grill session |
| 2026-07-08 | Deployment: self-hosted VPS, apps as subdomains of the team-website hub (dropped the earlier serverless-MVP plan) | Release planning |
| 2026-06-30 | UI: Discord-inspired dark theme | Grill session |
| 2026-06-30 | Testing: manual only, feedback doc for iteration | Grill session |
| 2026-06-30 | Auth: Phase 2 (Discord OAuth + RBAC) | Grill session |
| 2026-06-30 | Session logging: one-by-one (no bulk import) | Grill session |
| 2026-06-30 | Cars/Tracks: seed from Ohne Speed, admin form to add new | Grill session |

