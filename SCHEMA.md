# Database Schema — CrossCurrent Racing Platform

**Database:** PostgreSQL  
**Status:** MVP Phase 1  
**Last Updated:** 2026-06-30

---

## Tables

### `drivers`
Store driver metadata. Phase 2 adds Discord OAuth; Phase 1 is name-based.

```sql
CREATE TABLE drivers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  discord_id VARCHAR(255) UNIQUE,
  role VARCHAR(50) DEFAULT 'driver' CHECK (role IN ('driver', 'engineer', 'admin')),
  trust_score FLOAT DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `cars`
Car models (Porsche 992, Ferrari 296, etc.). Do not include per-instance metadata; cars are shared across team.

```sql
CREATE TABLE cars (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(50) NOT NULL CHECK (category IN ('Hypercar', 'GT3', 'LMP2', 'LMP3')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `tracks`
Race tracks. `layout_id` handles multi-layout tracks (e.g., Spa GP vs. Spa 24h).

```sql
CREATE TABLE tracks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  layout_id VARCHAR(50),
  country VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `sessions`
Individual test/race sessions logged by drivers.

```sql
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  car_id INT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  track_id INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  
  session_type VARCHAR(50) NOT NULL CHECK (session_type IN ('Practice', 'Quali', 'Race', 'Test')),
  condition_reported VARCHAR(50) NOT NULL CHECK (condition_reported IN ('Dry', 'Wet', 'Mixed')),
  patch_version VARCHAR(50),
  
  lap_count INT NOT NULL CHECK (lap_count > 0),
  best_lap_time FLOAT NOT NULL CHECK (best_lap_time > 0),
  avg_lap_time FLOAT NOT NULL CHECK (avg_lap_time > 0),
  
  off_track_count INT DEFAULT 0 CHECK (off_track_count >= 0),
  off_track_penalty_points FLOAT DEFAULT 0.0,
  
  confidence_rating FLOAT NOT NULL CHECK (confidence_rating BETWEEN 1.0 AND 10.0),
  setup_version VARCHAR(255),
  svm_data JSONB,
  comments TEXT,
  
  session_value_score FLOAT DEFAULT NULL CHECK (session_value_score IS NULL OR (session_value_score BETWEEN 0.0 AND 100.0)),
  value_components JSONB,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_sessions_car_track (car_id, track_id),
  INDEX idx_sessions_driver (driver_id),
  INDEX idx_sessions_created (created_at DESC)
);
```

### `tyres`
Per-session tyre wear data (one row per session, 4 tyre percentages).

```sql
CREATE TABLE tyres (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  
  tyre_fl_pct_remaining FLOAT NOT NULL CHECK (tyre_fl_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_fr_pct_remaining FLOAT NOT NULL CHECK (tyre_fr_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_rl_pct_remaining FLOAT NOT NULL CHECK (tyre_rl_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_rr_pct_remaining FLOAT NOT NULL CHECK (tyre_rr_pct_remaining BETWEEN 0.0 AND 100.0),
  
  avg_wear_pct FLOAT GENERATED ALWAYS AS (100.0 - ((tyre_fl_pct_remaining + tyre_fr_pct_remaining + tyre_rl_pct_remaining + tyre_rr_pct_remaining) / 4.0)) STORED,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `benchmarks`
Cached benchmark data from "Ohne Speed" Google Sheets. Synced daily.

```sql
CREATE TABLE benchmarks (
  id SERIAL PRIMARY KEY,
  track_id INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  class VARCHAR(50) NOT NULL CHECK (class IN ('LMGT3', 'LMH', 'LMP3', 'LMP2-ELMS', 'LMP2-WEC')),
  condition VARCHAR(50) NOT NULL CHECK (condition IN ('Dry', 'Wet', 'Mixed')),
  
  alien_time FLOAT NOT NULL CHECK (alien_time > 0),
  competitive_time FLOAT NOT NULL CHECK (competitive_time > 0),
  good_time FLOAT NOT NULL CHECK (good_time > 0),
  midpack_time FLOAT NOT NULL CHECK (midpack_time > 0),
  tail_ender_time FLOAT NOT NULL CHECK (tail_ender_time > 0),
  offline_time FLOAT NOT NULL CHECK (offline_time > 0),
  
  data_readiness_pct FLOAT DEFAULT 0.0 CHECK (data_readiness_pct BETWEEN 0.0 AND 100.0),
  patch_version VARCHAR(50),
  
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE (track_id, class, condition, patch_version),
  INDEX idx_benchmarks_track_class (track_id, class)
);
```

### `recommendations`
Computed Car Scores per car-track combo. Regenerated when new sessions are logged.

```sql
CREATE TABLE recommendations (
  id SERIAL PRIMARY KEY,
  car_id INT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  track_id INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  class VARCHAR(50) NOT NULL CHECK (class IN ('LMGT3', 'LMH', 'LMP3', 'LMP2-ELMS', 'LMP2-WEC')),
  condition VARCHAR(50) DEFAULT 'Dry',
  
  car_score FLOAT NOT NULL CHECK (car_score BETWEEN 0.0 AND 100.0),
  
  pace_factor FLOAT NOT NULL CHECK (pace_factor BETWEEN 0.0 AND 100.0),
  consistency_factor FLOAT NOT NULL CHECK (consistency_factor BETWEEN 0.0 AND 100.0),
  tyre_factor FLOAT NOT NULL CHECK (tyre_factor BETWEEN 0.0 AND 100.0),
  drivability_factor FLOAT NOT NULL CHECK (drivability_factor BETWEEN 0.0 AND 100.0),
  mistakes_factor FLOAT NOT NULL CHECK (mistakes_factor BETWEEN 0.0 AND 100.0),
  
  sessions_used INT NOT NULL CHECK (sessions_used > 0),
  session_ids JSONB,
  confidence_score FLOAT NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE (car_id, track_id, class, condition),
  INDEX idx_recommendations_track (track_id, class),
  INDEX idx_recommendations_score (car_score DESC)
);
```

---

## Indexes

Key queries and their indexes:

```sql
-- Rankings for a specific track/class (dashboard query)
SELECT * FROM recommendations 
WHERE track_id = ? AND class = ? 
ORDER BY car_score DESC;
  → INDEX: (track_id, class, car_score DESC)

-- Latest N sessions for a car-track combo (scoring engine)
SELECT * FROM sessions 
WHERE car_id = ? AND track_id = ? 
ORDER BY created_at DESC 
LIMIT 10;
  → INDEX: (car_id, track_id, created_at DESC)

-- Sync benchmark tiers
SELECT * FROM benchmarks 
WHERE track_id IN (...) AND patch_version = ?;
  → INDEX: (patch_version, track_id)
```

---

## Migrations (Initial)

**1_init_schema.sql**

```sql
-- Create schema
CREATE SCHEMA ccr;
SET search_path = ccr;

-- Drivers
CREATE TABLE drivers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  discord_id VARCHAR(255) UNIQUE,
  role VARCHAR(50) DEFAULT 'driver' CHECK (role IN ('driver', 'engineer', 'admin')),
  trust_score FLOAT DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cars
CREATE TABLE cars (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  category VARCHAR(50) NOT NULL CHECK (category IN ('Hypercar', 'GT3', 'LMP2', 'LMP3')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tracks
CREATE TABLE tracks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  layout_id VARCHAR(50),
  country VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  driver_id INT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  car_id INT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  track_id INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  session_type VARCHAR(50) NOT NULL CHECK (session_type IN ('Practice', 'Quali', 'Race', 'Test')),
  condition_reported VARCHAR(50) NOT NULL CHECK (condition_reported IN ('Dry', 'Wet', 'Mixed')),
  patch_version VARCHAR(50),
  lap_count INT NOT NULL CHECK (lap_count > 0),
  best_lap_time FLOAT NOT NULL CHECK (best_lap_time > 0),
  avg_lap_time FLOAT NOT NULL CHECK (avg_lap_time > 0),
  off_track_count INT DEFAULT 0 CHECK (off_track_count >= 0),
  off_track_penalty_points FLOAT DEFAULT 0.0,
  confidence_rating FLOAT NOT NULL CHECK (confidence_rating BETWEEN 1.0 AND 10.0),
  setup_version VARCHAR(255),
  svm_data JSONB,
  comments TEXT,
  session_value_score FLOAT CHECK (session_value_score IS NULL OR (session_value_score BETWEEN 0.0 AND 100.0)),
  value_components JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_car_track ON sessions(car_id, track_id);
CREATE INDEX idx_sessions_driver ON sessions(driver_id);
CREATE INDEX idx_sessions_created ON sessions(created_at DESC);

-- Tyres
CREATE TABLE tyres (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  tyre_fl_pct_remaining FLOAT NOT NULL CHECK (tyre_fl_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_fr_pct_remaining FLOAT NOT NULL CHECK (tyre_fr_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_rl_pct_remaining FLOAT NOT NULL CHECK (tyre_rl_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_rr_pct_remaining FLOAT NOT NULL CHECK (tyre_rr_pct_remaining BETWEEN 0.0 AND 100.0),
  avg_wear_pct FLOAT GENERATED ALWAYS AS (100.0 - ((tyre_fl_pct_remaining + tyre_fr_pct_remaining + tyre_rl_pct_remaining + tyre_rr_pct_remaining) / 4.0)) STORED,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Benchmarks
CREATE TABLE benchmarks (
  id SERIAL PRIMARY KEY,
  track_id INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  class VARCHAR(50) NOT NULL CHECK (class IN ('LMGT3', 'LMH', 'LMP3', 'LMP2-ELMS', 'LMP2-WEC')),
  condition VARCHAR(50) NOT NULL CHECK (condition IN ('Dry', 'Wet', 'Mixed')),
  alien_time FLOAT NOT NULL CHECK (alien_time > 0),
  competitive_time FLOAT NOT NULL CHECK (competitive_time > 0),
  good_time FLOAT NOT NULL CHECK (good_time > 0),
  midpack_time FLOAT NOT NULL CHECK (midpack_time > 0),
  tail_ender_time FLOAT NOT NULL CHECK (tail_ender_time > 0),
  offline_time FLOAT NOT NULL CHECK (offline_time > 0),
  data_readiness_pct FLOAT DEFAULT 0.0 CHECK (data_readiness_pct BETWEEN 0.0 AND 100.0),
  patch_version VARCHAR(50),
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (track_id, class, condition, patch_version)
);

CREATE INDEX idx_benchmarks_track_class ON benchmarks(track_id, class);

-- Recommendations
CREATE TABLE recommendations (
  id SERIAL PRIMARY KEY,
  car_id INT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  track_id INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  class VARCHAR(50) NOT NULL CHECK (class IN ('LMGT3', 'LMH', 'LMP3', 'LMP2-ELMS', 'LMP2-WEC')),
  condition VARCHAR(50) DEFAULT 'Dry',
  car_score FLOAT NOT NULL CHECK (car_score BETWEEN 0.0 AND 100.0),
  pace_factor FLOAT NOT NULL CHECK (pace_factor BETWEEN 0.0 AND 100.0),
  consistency_factor FLOAT NOT NULL CHECK (consistency_factor BETWEEN 0.0 AND 100.0),
  tyre_factor FLOAT NOT NULL CHECK (tyre_factor BETWEEN 0.0 AND 100.0),
  drivability_factor FLOAT NOT NULL CHECK (drivability_factor BETWEEN 0.0 AND 100.0),
  mistakes_factor FLOAT NOT NULL CHECK (mistakes_factor BETWEEN 0.0 AND 100.0),
  sessions_used INT NOT NULL CHECK (sessions_used > 0),
  session_ids JSONB,
  confidence_score FLOAT NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (car_id, track_id, class, condition)
);

CREATE INDEX idx_recommendations_track ON recommendations(track_id, class);
CREATE INDEX idx_recommendations_score ON recommendations(car_score DESC);
```

---

## Data Seeding (Initial Setup)

Pre-populate cars and tracks from the Ohne Speed spreadsheet:

**Cars:**
- Porsche 992 (GT3)
- Ferrari 296 (GT3)
- Cadillac V-Series.R (GT3)
- Lamborghini Huracán EVO II (GT3)
- BMW M Hybrid V8 (LMH)
- Toyota GR010 (LMH)
- Genesis GMR-001 (LMH)
- Peugeot 9X8 (LMH)
- Ginetta G61-LT-P3 (LMP3)
- Duqueine D09 (LMP3)
- Oreca 07-LMP2 (LMP2-ELMS)
- [... others from spreadsheet]

**Tracks:**
- Le Mans
- Spa
- Imola
- Bahrain
- COTA
- Fuji
- Portimao
- Qatar
- Silverstone
- Sebring
- Paul Ricard
- Monza
- [... others]

---

## Notes

- **No soft deletes:** If a session is incorrect, delete it and recompute recommendations.
- **Recommendations are read-only** (computed by the scoring engine). Manual update not expected.
- **Benchmark sync:** Google Sheets API call runs daily (or on-demand admin trigger). Updates `benchmarks` table; old entries are replaced.
- **Audit trail (Phase 2):** Add `audit_logs` table to track admin overrides and trust score changes.

