# CrossCurrent Racing Platform — Full Design Specification

**Status:** Locked (Phase 1 MVP)  
**Last Updated:** 2026-06-30  
**Grilled & Confirmed:** Yes (see CLAUDE.md for decision log)

---

## 1. Core Objective

Provide **deterministic, explainable, data-driven rankings** of cars per track/class using:
- Logged session lap data (lap times, consistency)
- Tyre wear metrics (per-tyre %)
- Off-track incident data (handling quality indicator)
- Driver confidence feedback
- Setup version tracking (optional; SVM parsing in Phase 2)
- Benchmark comparison against external "Ohne Speed" LMU laptop data

**Output:** A JSON-structured Car Score + 5-factor breakdown per car-track combo, weighted by session quality. Drivers see simple ranking; engineers/admins see full detail.

---

## 2. Data Model

### Entities

**Driver**
```
id (PK)
name
discord_id (Phase 2)
role (driver/engineer/admin; Phase 2)
trust_score (hidden, admin-only; Phase 2)
created_at
```

**Car**
```
id (PK)
name (e.g., "Porsche 992", "Toyota GR010", "Ferrari 296")
category (Hypercar / GT3 / LMP2 / LMP3)
created_at
```

**Track**
```
id (PK)
name (e.g., "Le Mans", "Spa", "Imola")
layout_id (for multi-layout tracks; nullable)
created_at
```

**Session**
```
id (PK)
driver_id (FK)
car_id (FK)
track_id (FK)
session_type (Practice / Quali / Race / Test)
condition_reported (Dry / Wet / Mixed)
patch_version (e.g., "1.3+", "1.2+"; for decay weighting)
lmu_patch_version
lap_count
best_lap_time (seconds, float)
avg_lap_time (seconds, float)
off_track_count (int)
off_track_penalty_points (float; future: advantage-based)
confidence_rating (1-10, float; driver assessment)
setup_version (string, e.g., "Basic V2, Quali")
svm_data (JSON, optional; raw SVM file parsed data)
session_value_score (0-100, computed)
value_components (JSON: completeness, consistency, cleanliness, representativeness, recency)
created_at
updated_at
```

**Tyre** (per session)
```
id (PK)
session_id (FK)
tyre_fl_pct_remaining (0-100)
tyre_fr_pct_remaining (0-100)
tyre_rl_pct_remaining (0-100)
tyre_rr_pct_remaining (0-100)
avg_wear_pct (computed: 100 - avg(remaining))
```

**Benchmark** (cached from Google Sheets)
```
id (PK)
track_id (FK)
class (LMGT3 / LMH / LMP3 / LMP2-ELMS / LMP2-WEC)
condition (Dry / Wet / Mixed)
alien_time (seconds, float)
competitive_time (float)
good_time (float)
midpack_time (float)
tail_ender_time (float)
offline_time (float)
data_readiness_pct (0-100; how much data backs this tier)
patch_version
last_synced_at
```

**Recommendation** (computed car score)
```
id (PK)
car_id (FK)
track_id (FK)
class (LMGT3 / LMH / LMP3 / LMP2)
car_score (0-100, float)
pace_factor (0-100)
consistency_factor (0-100)
tyre_factor (0-100)
drivability_factor (0-100)
mistakes_factor (0-100)
sessions_used (count of sessions in aggregation)
session_ids (JSON array of contributing session IDs)
confidence_score (0-1, float; based on data volume + quality)
last_updated
```

---

## 3. Scoring Engine

### 3.1 Pace Factor (35% weight)

**Input:** Driver's best lap time per session  
**Benchmark:** Google Sheets "Ohne Speed" pace tiers (Alien, Competitive, Good, Midpack, Tail-ender, Offline)

**Calculation:**
```
For track/class/condition:
  alien_time = benchmark.alien_time
  competitive_time = benchmark.competitive_time
  good_time = benchmark.good_time
  
  if driver_best_lap < alien_time:
    pace_score = 100  (alien pace)
  elif driver_best_lap < competitive_time:
    pace_score = 95   (near-alien)
  elif driver_best_lap < good_time:
    pace_score = 85   (competitive)
  elif driver_best_lap < midpack_time:
    pace_score = 70   (good)
  else:
    pace_score = 50 - ((driver_best_lap - midpack_time) / (tail_ender_time - midpack_time) * 30)
    pace_score = max(0, min(50, pace_score))
```

(Linear interpolation between tiers; precise formula TBD based on data distribution.)

### 3.2 Consistency Factor (25% weight)

**Input:** All lap times in the session (best, avg, std dev)  
**Metric:** Lap-to-lap variance relative to average lap time

**Calculation:**
```
std_dev = standard_deviation(all_lap_times)
avg_lap = average(all_lap_times)

consistency_score = 100 × (1 − (std_dev ÷ avg_lap))

Clamp to [0, 100].

Example:
  avg_lap = 227s (3:47)
  std_dev = 2s
  consistency_score = 100 × (1 − 2÷227) = 99.1/100
```

**Interpretation:** Low variance = high consistency = higher score. Curves gently so a 0.5s variance on a 3:47 lap isn't catastrophic.

### 3.3 Tyre Factor (15% weight)

**Input:** % remaining for each of 4 tyres (FL, FR, RL, RR)  
**Metric:** Average wear %; no benchmark; comparative across sessions/drivers

**Calculation:**
```
avg_wear_pct = 100 − avg([tyre_fl_pct, tyre_fr_pct, tyre_rl_pct, tyre_rr_pct])

Uniform wear (all 4 tyres ~same %) = softer on tyres = higher score.
Uneven wear (e.g., FL=50%, RR=20%) = harsh driving / setup issue = lower score.

tyre_uniformity = 100 − std_dev([tyre_fl_pct, tyre_fr_pct, tyre_rl_pct, tyre_rr_pct])

tyre_score = (100 − avg_wear_pct) × 0.6 + tyre_uniformity × 0.4

Example:
  wear_pct = 30% (all tyres ~30% worn, so 70% remaining)
  uniformity = 95 (very even)
  tyre_score = 70 × 0.6 + 95 × 0.4 = 42 + 38 = 80/100
```

**Interpretation:** Lower wear + uniform wear = tyre-friendly, predictable car. Useful for strategy (fewer pit stops) and setup diagnostics (uneven wear suggests setup imbalance).

### 3.4 Drivability Factor (15% weight)

**Input:** Driver's confidence rating (1-10 slider, collected during session logging)  
**Metric:** Direct scale

**Calculation:**
```
drivability_score = confidence_rating × 10

Example:
  confidence_rating = 8.5
  drivability_score = 85/100
```

**Interpretation:** Subjective, but critical. A car that's easy to drive consistently (high drivability) might be better for a sprint race; a trickier car (lower drivability) might reward skilled drivers in a longer race.

### 3.5 Mistakes Factor (10% weight)

**Input:** Off-track count in the session  
**Metric:** Normalized against expected max (~3 OTs per 10–15 laps)

**Calculation:**
```
laps_completed = session.lap_count
expected_ot_max = (laps_completed ÷ 12.5) × 3

mistakes_score = max(0, 100 − (off_track_count ÷ expected_ot_max × 100))

Example:
  laps_completed = 12
  off_track_count = 1
  expected_ot_max = (12 ÷ 12.5) × 3 = 2.88
  mistakes_score = 100 − (1 ÷ 2.88 × 100) = 65.3/100
  
  laps_completed = 12
  off_track_count = 4
  expected_ot_max = 2.88
  mistakes_score = max(0, 100 − (4 ÷ 2.88 × 100)) = 0/100 (fail)
```

**Interpretation:** OT incidents indicate handling issues or setup instability. A car that causes frequent OTs is hard to manage, especially in a long race (accumulating penalties). If OT count is way above expected, that car-track combo is problematic.

---

### 3.6 Session Value Score (weighting)

**Purpose:** Weight each session's contribution to the Car Score aggregate. High-quality sessions pull the average up; low-quality sessions have less influence.

**Components:**

| Component | Weight | Formula / Criteria |
|-----------|--------|-------------------|
| **Completeness** | 30% | Lap count ÷ typical race stint length (12-15 laps nominal). Full value at 15+, decay if <10. |
| **Consistency** | 25% | Lap-to-lap variance metric (same as Consistency Factor). Tighter variance = higher SVS component. |
| **Cleanliness** | 20% | Off-track count + incident severity. 0 OTs = 100; scale down with OT count. |
| **Representativeness** | 15% | Session type (Race/Quali > Practice/Test), condition (match to expected race conditions). Dry test session in dry weather = high. Wet practice in ideal conditions = lower. |
| **Recency** | 10% | Days since session. Fresh data (< 7 days) = higher. Older data (30+ days) = decay. Relative to current patch. |

**Aggregation:**
```
svs_completeness = completeness_score (0-100)
svs_consistency = consistency_score (0-100)  [reuse Consistency Factor]
svs_cleanliness = cleanliness_score (0-100)
svs_representativeness = representativeness_score (0-100)
svs_recency = recency_score (0-100)

session_value_score = 
  svs_completeness × 0.30 +
  svs_consistency × 0.25 +
  svs_cleanliness × 0.20 +
  svs_representativeness × 0.15 +
  svs_recency × 0.10
```

**Result:** 0–100 score per session.

---

### 3.7 Car Score (per-track aggregate)

**Input:** Latest 10 sessions for this car-track combo, each with 5 factors + Session Value Score  
**Aggregation:** Weighted average by Session Value Score

**Calculation:**
```
For each session i in [1..N]:
  pace[i], consistency[i], tyre[i], drivability[i], mistakes[i] = 5 factors
  svs[i] = session value score

Weighted aggregation:
  pace_final = Σ(pace[i] × svs[i]) ÷ Σ(svs[i])
  consistency_final = Σ(consistency[i] × svs[i]) ÷ Σ(svs[i])
  tyre_final = Σ(tyre[i] × svs[i]) ÷ Σ(svs[i])
  drivability_final = Σ(drivability[i] × svs[i]) ÷ Σ(svs[i])
  mistakes_final = Σ(mistakes[i] × svs[i]) ÷ Σ(svs[i])

car_score = 
  pace_final × 0.35 +
  consistency_final × 0.25 +
  tyre_final × 0.15 +
  drivability_final × 0.15 +
  mistakes_final × 0.10
```

**Confidence Score:**
```
confidence = (N / 10) × (avg(svs) / 100)

Where:
  N = session count (0-10)
  avg(svs) = average session value score

Result: 0–1 (0% to 100%).
A recommendation built on 10 high-quality sessions = 1.0 confidence.
A recommendation built on 2 low-quality sessions = ~0.2 confidence.
```

**Output JSON:**
```json
{
  "car": "Porsche 992",
  "track": "Le Mans",
  "class": "LMGT3",
  "car_score": 87.3,
  "factors": {
    "pace": 85,
    "consistency": 90,
    "tyre": 88,
    "drivability": 89,
    "mistakes": 82
  },
  "sessions_used": 8,
  "last_updated": "2026-06-30T14:22:00Z",
  "confidence": 0.87,
  "session_ids": [456, 457, 458, 459, 460, 461, 462, 463]
}
```

---

## 4. Benchmark Data (Google Sheets Sync)

**Source:** "Ohne Speed - LMU laptimes spreadsheet" (public Google Sheets)  
**Sync:** Daily via Google Sheets API  
**Fallback:** Cache yesterday's data if sync fails  
**Manual:** Admin can trigger refresh or upload CSV

**Data Structure:**
- Tracks: 20+ (Le Mans, Spa, Imola, Bahrain, COTA, Fuji, Portimao, Qatar, Silverstone, Sebring, Paul Ricard, Monza, etc.)
- Classes: LMGT3, LMH, LMP3, LMP2-ELMS, LMP2-WEC
- Conditions: Dry, Wet, Mixed (or per-track variants)
- Tiers: Alien (~100%), Competitive (101%), Good (102%), Midpack (103–105%), Tail-ender (106%), Offline (107%)
- Data Readiness: % of laps used to compute each tier (confidence indicator)

**Cached in DB:**
```
INSERT INTO benchmarks (track_id, class, condition, alien_time, competitive_time, good_time, midpack_time, 
  tail_ender_time, offline_time, data_readiness_pct, patch_version, last_synced_at)
```

---

## 5. Frontend UX (MVP Phase 1)

### 5.1 Session Logging Form (reuse the original prototype layout)

**Fields:**
- Driver name (text input)
- Driver level dropdown (Intermediate / Advanced / Expert)
- Track dropdown (Le Mans, Spa, Imola, etc.)
- Car dropdown (Porsche 992, Ferrari 296, Toyota GR010, etc.)
- Session type (Practice / Quali / Race / Test)
- Weather (Dry / Wet / Mixed)

**Lap Data:**
- Best lap (MM:SS.mmm format)
- Average lap (MM:SS.mmm)
- Laps completed (int)

**Tyre Data (4 fields):**
- Tyre FL % remaining (0-100)
- Tyre FR % remaining (0-100)
- Tyre RL % remaining (0-100)
- Tyre RR % remaining (0-100)

**Incidents:**
- Off-track count (int)
- Lockups (int; future use)

**Setup:**
- Setup version (text, e.g., "Basic V2 Quali")
- Setup file (optional SVM upload; Phase 2)

**Assessment:**
- Confidence in car (1-10 slider)
- Comments (free text)

**Submit:** POST to `/api/sessions` → stores in PostgreSQL

### 5.2 Rankings Dashboard

**Layout:**
- Track selector (dropdown or tabs)
- Class filter (LMGT3 / LMH / LMP3 / LMP2)
- Condition filter (Dry / Wet / Mixed; or "all")

**Table:**
| Rank | Car | Score | Pace | Consistency | Tyre | Drivability | Mistakes | Sessions | Confidence |
|------|-----|-------|------|-------------|------|-------------|----------|----------|------------|
| 1 | Porsche 992 | 87.3 | 85 | 90 | 88 | 89 | 82 | 8 | 87% |
| 2 | Ferrari 296 | 84.1 | 82 | 88 | 85 | 86 | 80 | 6 | 71% |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

**Click on car row** → detail view (all contributing sessions, individual session breakdowns, tyre wear patterns, setup notes)

### 5.3 Export

**Formats:** JSON (full detail), CSV (summary rankings)  
**Trigger:** Export button on dashboard

---

## 6. API Endpoints (MVP Phase 1)

### Session Management
- `POST /api/sessions` — Create session
- `GET /api/sessions` — List sessions (filtered by car, track, driver)
- `GET /api/sessions/:id` — Get session detail
- `PUT /api/sessions/:id` — Update session
- `DELETE /api/sessions/:id` — Delete session

### Rankings & Recommendations
- `GET /api/rankings` — List car scores (filtered by track, class, condition)
- `GET /api/rankings/:carId/:trackId` — Get specific car-track score + breakdown
- `POST /api/rankings/recompute` — Trigger scoring engine (for all or specific car-track combos)

### Benchmark Data
- `GET /api/benchmarks` — List all benchmark tiers
- `GET /api/benchmarks/:trackId/:class` — Get tiers for track/class
- `POST /api/benchmarks/sync` — Manually trigger Google Sheets sync

### Metadata
- `GET /api/cars` — List all cars
- `GET /api/tracks` — List all tracks
- `GET /api/drivers` — List all drivers (basic, no auth in Phase 1)

---

## 7. Data Priority (when conflicts arise)

1. **Admin verified** — Admin has marked this data as correct
2. **System detected** — Scoring engine auto-flagged consistency issues
3. **Driver reported** — Driver manually entered via session form
4. **Benchmark inference** — Extrapolated from benchmark data

---

## 8. Known Unknowns (Phase 2+)

- **Session Value Score formula:** All 5 components need real testing on sample data to calibrate weights.
- **Patch decay curve:** How old should data get before it's ignored? (Proposal: exponential decay beyond 2 patches)
- **Trust system:** How much should a low-trust driver's data be downweighted? (Proposal: 0.5–1.0 multiplier)
- **SVM parsing:** Which setup parameters correlate most with pace/consistency/tyre? (Machine learning opportunity)
- **Multi-driver aggregation:** If 3 drivers test a car on the same track, how do we handle different skill levels? (Proposal: per-driver baseline, then delta comparison)

---

## 9. Success Criteria (MVP Phase 1)

✅ Session logging form works (data persists to DB)  
✅ 10+ test sessions logged across 3+ cars  
✅ Scoring engine computes Car Scores without errors  
✅ Rankings dashboard displays top 5 cars per track, sorted by Car Score  
✅ Confidence score correlates with data volume + quality (spot-check)  
✅ JSON/CSV export produces valid, readable output  
✅ Google Sheets benchmark sync runs daily, caches on failure  
✅ No authentication errors or data leaks (local testing only; Phase 2 = auth)  

---

## References

- **Ohne Speed LMU Laptimes:** https://docs.google.com/spreadsheets/d/e/2PACX-1vTN03UvJDm99byA6vQPZHKOCYVvfxLu1zkJAzdaKyROykzEKY2-Xl1rl1q5znZEf36m88dxMKsY2eaO/pubhtml
- **Original Spec (v1.0):** `crosscurrent_racing_spec.md`

