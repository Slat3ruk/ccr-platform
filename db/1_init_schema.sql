-- ============================================================================
-- CrossCurrent Racing Platform — initial schema (PostgreSQL)
-- Run once against a fresh database:  psql "$DATABASE_URL" -f db/1_init_schema.sql
-- Idempotent: safe to re-run. Tables live in the `ccr` schema; the app sets
-- search_path=ccr on every connection (see src/lib/db/postgres.ts).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ccr;
SET search_path = ccr;

-- Drivers ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  discord_id  VARCHAR(255) UNIQUE,
  role        VARCHAR(50) DEFAULT 'driver' CHECK (role IN ('driver', 'engineer', 'admin')),
  trust_score FLOAT DEFAULT 1.0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_name ON drivers (LOWER(name));

-- Cars ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cars (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL UNIQUE,
  category   VARCHAR(50) NOT NULL CHECK (category IN ('Hypercar', 'GT3', 'LMP2', 'LMP3')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tracks ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracks (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL UNIQUE,
  layout_id  VARCHAR(50),
  country    VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id                       SERIAL PRIMARY KEY,
  driver_id                INT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  car_id                   INT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  track_id                 INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  session_type             VARCHAR(50) NOT NULL CHECK (session_type IN ('Practice', 'Quali', 'Race', 'Test')),
  condition_reported       VARCHAR(50) NOT NULL CHECK (condition_reported IN ('Dry', 'Wet', 'Mixed')),
  patch_version            VARCHAR(50),
  lap_count                INT NOT NULL CHECK (lap_count > 0),
  best_lap_time            FLOAT NOT NULL CHECK (best_lap_time > 0),
  avg_lap_time             FLOAT NOT NULL CHECK (avg_lap_time > 0),
  off_track_count          INT DEFAULT 0 CHECK (off_track_count >= 0),
  off_track_penalty_points FLOAT DEFAULT 0.0,
  confidence_rating        FLOAT NOT NULL CHECK (confidence_rating BETWEEN 1.0 AND 10.0),
  setup_type               VARCHAR(100),
  setup_version            VARCHAR(255),
  svm_data                 JSONB,
  comments                 TEXT,
  lap_times                JSONB,
  session_value_score      FLOAT CHECK (session_value_score IS NULL OR (session_value_score BETWEEN 0.0 AND 100.0)),
  value_components         JSONB,
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Additive column for DBs created before the per-lap-times feature.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lap_times JSONB;
-- Additive column for DBs created before the controlled setup-type dropdown.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS setup_type VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_sessions_car_track ON sessions(car_id, track_id);
CREATE INDEX IF NOT EXISTS idx_sessions_driver    ON sessions(driver_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created   ON sessions(created_at DESC);

-- Tyres (one row per session) -------------------------------------------------
CREATE TABLE IF NOT EXISTS tyres (
  id                    SERIAL PRIMARY KEY,
  session_id            INT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  tyre_fl_pct_remaining FLOAT NOT NULL CHECK (tyre_fl_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_fr_pct_remaining FLOAT NOT NULL CHECK (tyre_fr_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_rl_pct_remaining FLOAT NOT NULL CHECK (tyre_rl_pct_remaining BETWEEN 0.0 AND 100.0),
  tyre_rr_pct_remaining FLOAT NOT NULL CHECK (tyre_rr_pct_remaining BETWEEN 0.0 AND 100.0),
  avg_wear_pct          FLOAT GENERATED ALWAYS AS
    (100.0 - ((tyre_fl_pct_remaining + tyre_fr_pct_remaining + tyre_rl_pct_remaining + tyre_rr_pct_remaining) / 4.0)) STORED,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Benchmarks (cached from Ohne Speed sheet) -----------------------------------
CREATE TABLE IF NOT EXISTS benchmarks (
  id                 SERIAL PRIMARY KEY,
  track_id           INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  class              VARCHAR(50) NOT NULL CHECK (class IN ('LMGT3', 'LMH', 'LMP3', 'LMP2-ELMS', 'LMP2-WEC')),
  condition          VARCHAR(50) NOT NULL CHECK (condition IN ('Dry', 'Wet', 'Mixed')),
  alien_time         FLOAT NOT NULL CHECK (alien_time > 0),
  competitive_time   FLOAT NOT NULL CHECK (competitive_time > 0),
  good_time          FLOAT NOT NULL CHECK (good_time > 0),
  midpack_time       FLOAT NOT NULL CHECK (midpack_time > 0),
  tail_ender_time    FLOAT NOT NULL CHECK (tail_ender_time > 0),
  offline_time       FLOAT NOT NULL CHECK (offline_time > 0),
  data_readiness_pct FLOAT DEFAULT 0.0 CHECK (data_readiness_pct BETWEEN 0.0 AND 100.0),
  patch_version      VARCHAR(50),
  last_synced_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (track_id, class, condition, patch_version)
);
CREATE INDEX IF NOT EXISTS idx_benchmarks_track_class ON benchmarks(track_id, class);

-- Recommendations (computed car scores) ---------------------------------------
CREATE TABLE IF NOT EXISTS recommendations (
  id                 SERIAL PRIMARY KEY,
  car_id             INT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  track_id           INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  class              VARCHAR(50) NOT NULL CHECK (class IN ('LMGT3', 'LMH', 'LMP3', 'LMP2-ELMS', 'LMP2-WEC')),
  condition          VARCHAR(50) DEFAULT 'Dry',
  car_score          FLOAT NOT NULL CHECK (car_score BETWEEN 0.0 AND 100.0),
  pace_factor        FLOAT NOT NULL CHECK (pace_factor BETWEEN 0.0 AND 100.0),
  consistency_factor FLOAT NOT NULL CHECK (consistency_factor BETWEEN 0.0 AND 100.0),
  tyre_factor        FLOAT NOT NULL CHECK (tyre_factor BETWEEN 0.0 AND 100.0),
  drivability_factor FLOAT NOT NULL CHECK (drivability_factor BETWEEN 0.0 AND 100.0),
  mistakes_factor    FLOAT NOT NULL CHECK (mistakes_factor BETWEEN 0.0 AND 100.0),
  sessions_used      INT NOT NULL CHECK (sessions_used > 0),
  session_ids        JSONB,
  confidence_score   FLOAT NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0),
  weights_preset     VARCHAR(50),
  best_setup         VARCHAR(255),
  last_updated       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (car_id, track_id, class, condition)
);
CREATE INDEX IF NOT EXISTS idx_recommendations_track ON recommendations(track_id, class);
CREATE INDEX IF NOT EXISTS idx_recommendations_score ON recommendations(car_score DESC);
-- Additive columns for older DBs created before the weighting / best-setup features.
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS weights_preset VARCHAR(50);
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS best_setup VARCHAR(255);

-- Settings (key/value — e.g. the active Car-Score weighting preset) -----------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Eras (data "lines in the sand" — sessions assign by timestamp, nothing deleted)
CREATE TABLE IF NOT EXISTS eras (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  starts_at  TIMESTAMP NOT NULL,
  reason     TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Races (manually-added calendar + BLUF briefing note) ------------------------
CREATE TABLE IF NOT EXISTS races (
  id              SERIAL PRIMARY KEY,
  track_id        INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  class           VARCHAR(50) CHECK (class IS NULL OR class IN ('LMGT3', 'LMH', 'LMP3', 'LMP2-ELMS', 'LMP2-WEC')),
  condition       VARCHAR(50) CHECK (condition IS NULL OR condition IN ('Dry', 'Wet', 'Mixed')),
  name            VARCHAR(255),
  event_date      DATE NOT NULL,
  note            TEXT,
  note_by         VARCHAR(255),
  note_updated_at TIMESTAMP,
  created_by      VARCHAR(255),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_races_event_date ON races(event_date);
