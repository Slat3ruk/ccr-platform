// ============================================================================
// Postgres store — the production backend, active when DATABASE_URL is set.
// `pg` is imported lazily so the dev (JSON) path never needs it installed/wired.
// Tables live in the `ccr` schema (see db/1_init_schema.sql); search_path is
// pinned per-pool.
// ============================================================================

import type {
  Benchmark,
  Car,
  CarCategory,
  Condition,
  Driver,
  Era,
  NewEraInput,
  NewRaceInput,
  NewRaceResultInput,
  NewTestRequestInput,
  RaceEvent,
  RaceResult,
  RacingClass,
  Recommendation,
  Session,
  TestRequest,
  Track,
  TrackPatch,
  ValueComponents,
} from "@/types";
import type {
  NewBenchmark,
  NewRecommendation,
  NewSessionRecord,
  RacePatch,
  SessionFilter,
  Store,
} from "./types";

// Minimal structural types so we don't hard-depend on @types/pg at module load.
interface PgPool {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  connect(): Promise<PgClient>;
}
interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
  release(): void;
}

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return new Date().toISOString();
}

/** Row → Track. `length_km` is nullable and absent on rows predating the column. */
function trackRow(r: Record<string, unknown>): Track {
  return {
    id: r.id as number,
    name: r.name as string,
    layout_id: (r.layout_id as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    length_km: r.length_km == null ? null : Number(r.length_km),
    created_at: iso(r.created_at),
  };
}

const SESSION_SELECT = `
  SELECT s.*,
         t.tyre_fl_pct_remaining, t.tyre_fr_pct_remaining,
         t.tyre_rl_pct_remaining, t.tyre_rr_pct_remaining, t.avg_wear_pct
  FROM sessions s
  JOIN tyres t ON t.session_id = s.id
`;

function rowToSession(r: any): Session {
  return {
    id: r.id,
    driver_id: r.driver_id,
    car_id: r.car_id,
    track_id: r.track_id,
    session_type: r.session_type,
    condition_reported: r.condition_reported,
    patch_version: r.patch_version,
    lap_count: r.lap_count,
    best_lap_time: Number(r.best_lap_time),
    avg_lap_time: Number(r.avg_lap_time),
    off_track_count: r.off_track_count,
    off_track_penalty_points: Number(r.off_track_penalty_points),
    confidence_rating: Number(r.confidence_rating),
    setup_type: r.setup_type ?? null,
    setup_version: r.setup_version,
    svm_data: r.svm_data,
    comments: r.comments,
    lap_times: r.lap_times ?? null,
    session_value_score: r.session_value_score == null ? null : Number(r.session_value_score),
    value_components: r.value_components ?? null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    tyres: {
      tyre_fl_pct_remaining: Number(r.tyre_fl_pct_remaining),
      tyre_fr_pct_remaining: Number(r.tyre_fr_pct_remaining),
      tyre_rl_pct_remaining: Number(r.tyre_rl_pct_remaining),
      tyre_rr_pct_remaining: Number(r.tyre_rr_pct_remaining),
      avg_wear_pct: Number(r.avg_wear_pct),
    },
  };
}

function rowToBenchmark(r: any): Benchmark {
  return {
    id: r.id,
    track_id: r.track_id,
    class: r.class,
    condition: r.condition,
    alien_time: Number(r.alien_time),
    competitive_time: Number(r.competitive_time),
    good_time: Number(r.good_time),
    good_102_time: r.good_102_time == null ? null : Number(r.good_102_time),
    midpack_time: Number(r.midpack_time),
    midpack_104_time: r.midpack_104_time == null ? null : Number(r.midpack_104_time),
    tail_ender_time: Number(r.tail_ender_time),
    offline_time: Number(r.offline_time),
    data_readiness_pct: Number(r.data_readiness_pct),
    patch_version: r.patch_version,
    last_synced_at: iso(r.last_synced_at),
  };
}

function rowToRecommendation(r: any): Recommendation {
  return {
    id: r.id,
    car_id: r.car_id,
    track_id: r.track_id,
    class: r.class,
    condition: r.condition,
    car_score: Number(r.car_score),
    pace_factor: Number(r.pace_factor),
    consistency_factor: Number(r.consistency_factor),
    tyre_factor: Number(r.tyre_factor),
    drivability_factor: Number(r.drivability_factor),
    mistakes_factor: Number(r.mistakes_factor),
    sessions_used: r.sessions_used,
    session_ids: r.session_ids ?? [],
    confidence_score: Number(r.confidence_score),
    weights_preset: r.weights_preset ?? null,
    best_setup: r.best_setup ?? null,
    last_updated: iso(r.last_updated),
  };
}

function rowToTestRequest(r: any): TestRequest {
  return {
    id: r.id,
    car_id: r.car_id,
    track_id: r.track_id,
    condition: r.condition,
    note: r.note ?? null,
    created_by: r.created_by ?? null,
    created_at: iso(r.created_at),
  };
}

function rowToRaceResult(r: any): RaceResult {
  return {
    id: r.id,
    track_id: r.track_id,
    class: r.class,
    raced_on: typeof r.raced_on === "string" ? r.raced_on.slice(0, 10) : iso(r.raced_on).slice(0, 10),
    recommended_car_id: r.recommended_car_id ?? null,
    raced_car_id: r.raced_car_id,
    verdict: r.verdict,
    position: r.position ?? null,
    note: r.note ?? null,
    created_by: r.created_by ?? null,
    created_at: iso(r.created_at),
  };
}

function rowToRace(r: any): RaceEvent {
  return {
    id: r.id,
    track_id: r.track_id,
    class: r.class ?? null,
    condition: r.condition ?? null,
    name: r.name ?? null,
    event_date: typeof r.event_date === "string" ? r.event_date.slice(0, 10) : iso(r.event_date).slice(0, 10),
    start_at: r.start_at ? iso(r.start_at) : null,
    note: r.note ?? null,
    note_by: r.note_by ?? null,
    note_updated_at: r.note_updated_at ? iso(r.note_updated_at) : null,
    created_by: r.created_by ?? null,
    created_at: iso(r.created_at),
  };
}

export class PostgresStore implements Store {
  readonly kind = "postgres";
  private pool: PgPool | null = null;
  private initialized = false;

  constructor(private connectionString: string) {}

  private async getPool(): Promise<PgPool> {
    if (this.pool) return this.pool;
    // Lazy require so the JSON path doesn't need pg present.
    const pg = await import("pg");
    const Pool = (pg as any).Pool ?? (pg as any).default?.Pool;
    const ssl =
      process.env.PGSSL === "disable"
        ? false
        : /sslmode=require|neon|supabase|render|railway|amazonaws/i.test(this.connectionString)
          ? { rejectUnauthorized: false }
          : undefined;
    this.pool = new Pool({
      connectionString: this.connectionString,
      ssl,
      options: "-c search_path=ccr",
      max: 5,
    }) as PgPool;
    return this.pool;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const pool = await this.getPool();
    // Ensure the schema exists; full DDL lives in db/1_init_schema.sql.
    await pool.query("CREATE SCHEMA IF NOT EXISTS ccr");
    // Additive migrations for the weighting + calendar features, so an already
    // migrated production DB gets them without re-running the base schema file.
    await pool.query(
      "CREATE TABLE IF NOT EXISTS ccr.settings (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ccr.races (
        id              SERIAL PRIMARY KEY,
        track_id        INT NOT NULL REFERENCES ccr.tracks(id) ON DELETE CASCADE,
        class           VARCHAR(50),
        condition       VARCHAR(50),
        name            VARCHAR(255),
        event_date      DATE NOT NULL,
        note            TEXT,
        note_by         VARCHAR(255),
        note_updated_at TIMESTAMP,
        created_by      VARCHAR(255),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    await pool.query("ALTER TABLE ccr.races ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ccr.test_requests (
        id         SERIAL PRIMARY KEY,
        car_id     INT NOT NULL REFERENCES ccr.cars(id) ON DELETE CASCADE,
        track_id   INT NOT NULL REFERENCES ccr.tracks(id) ON DELETE CASCADE,
        condition  VARCHAR(50) NOT NULL,
        note       TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    await pool.query("ALTER TABLE ccr.recommendations ADD COLUMN IF NOT EXISTS weights_preset VARCHAR(50)");
    await pool.query("ALTER TABLE ccr.recommendations ADD COLUMN IF NOT EXISTS best_setup VARCHAR(255)");
    await pool.query("ALTER TABLE ccr.sessions ADD COLUMN IF NOT EXISTS lap_times JSONB");
    await pool.query("ALTER TABLE ccr.sessions ADD COLUMN IF NOT EXISTS setup_type VARCHAR(100)");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ccr.race_results (
        id                 SERIAL PRIMARY KEY,
        track_id           INT NOT NULL REFERENCES ccr.tracks(id) ON DELETE CASCADE,
        class              VARCHAR(50) NOT NULL,
        raced_on           DATE NOT NULL,
        recommended_car_id INT REFERENCES ccr.cars(id) ON DELETE SET NULL,
        raced_car_id       INT NOT NULL REFERENCES ccr.cars(id) ON DELETE CASCADE,
        verdict            VARCHAR(20) NOT NULL,
        position           VARCHAR(100),
        note               TEXT,
        created_by         VARCHAR(255),
        created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ccr.eras (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        starts_at  TIMESTAMP NOT NULL,
        reason     TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    this.initialized = true;
  }

  private async q(text: string, params?: unknown[]) {
    const pool = await this.getPool();
    return pool.query(text, params);
  }

  // drivers -------------------------------------------------------------------
  async getOrCreateDriver(name: string): Promise<Driver> {
    const found = await this.q("SELECT * FROM drivers WHERE LOWER(name) = LOWER($1) LIMIT 1", [name]);
    if (found.rows[0]) return this.driver(found.rows[0]);
    const ins = await this.q("INSERT INTO drivers (name) VALUES ($1) RETURNING *", [name]);
    return this.driver(ins.rows[0]);
  }

  async getOrCreateDriverByDiscordId(discordId: string, name: string): Promise<Driver> {
    const byId = await this.q("SELECT * FROM drivers WHERE discord_id = $1 LIMIT 1", [discordId]);
    if (byId.rows[0]) return this.driver(byId.rows[0]);

    const byName = await this.q("SELECT * FROM drivers WHERE discord_id IS NULL AND LOWER(name) = LOWER($1) LIMIT 1", [name]);
    if (byName.rows[0]) {
      const upd = await this.q("UPDATE drivers SET discord_id = $1, name = $2, updated_at = now() WHERE id = $3 RETURNING *", [
        discordId,
        name,
        byName.rows[0].id,
      ]);
      return this.driver(upd.rows[0]);
    }

    const ins = await this.q("INSERT INTO drivers (name, discord_id) VALUES ($1, $2) RETURNING *", [name, discordId]);
    return this.driver(ins.rows[0]);
  }

  private driver(r: any): Driver {
    return {
      id: r.id,
      name: r.name,
      discord_id: r.discord_id,
      role: r.role,
      trust_score: Number(r.trust_score),
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
    };
  }

  async listDrivers(): Promise<Driver[]> {
    const res = await this.q("SELECT * FROM drivers ORDER BY name");
    return res.rows.map((r) => this.driver(r));
  }

  // cars ----------------------------------------------------------------------
  async listCars(): Promise<Car[]> {
    const res = await this.q("SELECT * FROM cars ORDER BY name");
    return res.rows.map((r) => ({ id: r.id, name: r.name, category: r.category, created_at: iso(r.created_at) }));
  }

  async getCar(id: number): Promise<Car | null> {
    const res = await this.q("SELECT * FROM cars WHERE id = $1", [id]);
    const r = res.rows[0];
    return r ? { id: r.id, name: r.name, category: r.category, created_at: iso(r.created_at) } : null;
  }

  async createCar(name: string, category: CarCategory): Promise<Car> {
    const res = await this.q(
      "INSERT INTO cars (name, category) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category RETURNING *",
      [name, category],
    );
    const r = res.rows[0];
    return { id: r.id, name: r.name, category: r.category, created_at: iso(r.created_at) };
  }

  // tracks --------------------------------------------------------------------
  async listTracks(): Promise<Track[]> {
    const res = await this.q("SELECT * FROM tracks ORDER BY name");
    return res.rows.map(trackRow);
  }

  async getTrack(id: number): Promise<Track | null> {
    const res = await this.q("SELECT * FROM tracks WHERE id = $1", [id]);
    const r = res.rows[0];
    return r ? trackRow(r) : null;
  }

  async createTrack(
    name: string,
    layout_id: string | null = null,
    country: string | null = null,
    length_km: number | null = null,
  ): Promise<Track> {
    const res = await this.q(
      "INSERT INTO tracks (name, layout_id, country, length_km) VALUES ($1, $2, $3, $4) " +
        "ON CONFLICT (name) DO UPDATE SET layout_id = EXCLUDED.layout_id RETURNING *",
      [name, layout_id, country, length_km],
    );
    return trackRow(res.rows[0]);
  }

  async updateTrack(id: number, patch: TrackPatch): Promise<Track | null> {
    // Build the SET list from only the keys actually supplied, so an omitted
    // field is left alone rather than being nulled.
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const key of ["name", "layout_id", "country", "length_km"] as const) {
      if (patch[key] !== undefined) {
        cols.push(`${key} = $${cols.length + 1}`);
        vals.push(patch[key]);
      }
    }
    if (!cols.length) return this.getTrack(id);
    vals.push(id);
    const res = await this.q(`UPDATE tracks SET ${cols.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
    return res.rows[0] ? trackRow(res.rows[0]) : null;
  }

  // sessions ------------------------------------------------------------------
  async createSession(rec: NewSessionRecord): Promise<Session> {
    const pool = await this.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const s = await client.query(
        `INSERT INTO sessions
          (driver_id, car_id, track_id, session_type, condition_reported, patch_version,
           lap_count, best_lap_time, avg_lap_time, off_track_count, off_track_penalty_points,
           confidence_rating, setup_type, setup_version, comments, lap_times)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
          rec.driver_id, rec.car_id, rec.track_id, rec.session_type, rec.condition_reported, rec.patch_version ?? null,
          rec.lap_count, rec.best_lap_time, rec.avg_lap_time, rec.off_track_count, rec.off_track_penalty_points,
          rec.confidence_rating, rec.setup_type ?? null, rec.setup_version ?? null, rec.comments ?? null,
          rec.lap_times ? JSON.stringify(rec.lap_times) : null,
        ],
      );
      const id = s.rows[0].id;
      await client.query(
        `INSERT INTO tyres (session_id, tyre_fl_pct_remaining, tyre_fr_pct_remaining, tyre_rl_pct_remaining, tyre_rr_pct_remaining)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, rec.tyre_fl_pct_remaining, rec.tyre_fr_pct_remaining, rec.tyre_rl_pct_remaining, rec.tyre_rr_pct_remaining],
      );
      await client.query("COMMIT");
      const out = await this.getSession(id);
      return out as Session;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async getSession(id: number): Promise<Session | null> {
    const res = await this.q(`${SESSION_SELECT} WHERE s.id = $1`, [id]);
    return res.rows[0] ? rowToSession(res.rows[0]) : null;
  }

  async listSessions(filter: SessionFilter = {}): Promise<Session[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.car_id != null) { params.push(filter.car_id); where.push(`s.car_id = $${params.length}`); }
    if (filter.track_id != null) { params.push(filter.track_id); where.push(`s.track_id = $${params.length}`); }
    if (filter.driver_id != null) { params.push(filter.driver_id); where.push(`s.driver_id = $${params.length}`); }
    let sql = `${SESSION_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY s.created_at DESC, s.id DESC`;
    if (filter.limit != null) { params.push(filter.limit); sql += ` LIMIT $${params.length}`; }
    const res = await this.q(sql, params);
    return res.rows.map(rowToSession);
  }

  async updateSession(id: number, patch: Partial<NewSessionRecord>): Promise<Session | null> {
    const sessionCols: (keyof NewSessionRecord)[] = [
      "driver_id", "car_id", "track_id", "session_type", "condition_reported", "patch_version",
      "lap_count", "best_lap_time", "avg_lap_time", "off_track_count", "off_track_penalty_points",
      "confidence_rating", "setup_type", "setup_version", "comments", "lap_times",
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of sessionCols) {
      if (col in patch) {
        const raw = (patch as any)[col];
        // JSONB column: pg serialises JS arrays as PG arrays, so stringify.
        params.push(col === "lap_times" && raw != null ? JSON.stringify(raw) : raw);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length) {
      params.push(id);
      await this.q(`UPDATE sessions SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length}`, params);
    }
    const tyreCols = ["tyre_fl_pct_remaining", "tyre_fr_pct_remaining", "tyre_rl_pct_remaining", "tyre_rr_pct_remaining"] as const;
    const tSets: string[] = [];
    const tParams: unknown[] = [];
    for (const col of tyreCols) {
      if (col in patch) { tParams.push((patch as any)[col]); tSets.push(`${col} = $${tParams.length}`); }
    }
    if (tSets.length) {
      tParams.push(id);
      await this.q(`UPDATE tyres SET ${tSets.join(", ")} WHERE session_id = $${tParams.length}`, tParams);
    }
    return this.getSession(id);
  }

  async deleteSession(id: number): Promise<boolean> {
    const res = await this.q("DELETE FROM sessions WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async setSessionValue(id: number, svs: number, components: ValueComponents): Promise<void> {
    await this.q("UPDATE sessions SET session_value_score = $1, value_components = $2 WHERE id = $3", [
      svs,
      JSON.stringify(components),
      id,
    ]);
  }

  // benchmarks ----------------------------------------------------------------
  async listBenchmarks(): Promise<Benchmark[]> {
    const res = await this.q("SELECT * FROM benchmarks ORDER BY track_id, class, condition");
    return res.rows.map(rowToBenchmark);
  }

  async getBenchmark(track_id: number, cls: RacingClass, condition: Condition): Promise<Benchmark | null> {
    const res = await this.q(
      "SELECT * FROM benchmarks WHERE track_id = $1 AND class = $2 AND condition = $3 ORDER BY last_synced_at DESC LIMIT 1",
      [track_id, cls, condition],
    );
    return res.rows[0] ? rowToBenchmark(res.rows[0]) : null;
  }

  async upsertBenchmark(b: NewBenchmark): Promise<Benchmark> {
    const existing = await this.q(
      "SELECT id FROM benchmarks WHERE track_id = $1 AND class = $2 AND condition = $3 LIMIT 1",
      [b.track_id, b.class, b.condition],
    );
    if (existing.rows[0]) {
      const res = await this.q(
        `UPDATE benchmarks SET alien_time=$1, competitive_time=$2, good_time=$3, good_102_time=$4,
           midpack_time=$5, midpack_104_time=$6, tail_ender_time=$7, offline_time=$8, data_readiness_pct=$9,
           patch_version=$10, last_synced_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$11 RETURNING *`,
        [
          b.alien_time,
          b.competitive_time,
          b.good_time,
          b.good_102_time ?? null,
          b.midpack_time,
          b.midpack_104_time ?? null,
          b.tail_ender_time,
          b.offline_time,
          b.data_readiness_pct,
          b.patch_version ?? null,
          existing.rows[0].id,
        ],
      );
      return rowToBenchmark(res.rows[0]);
    }
    const res = await this.q(
      `INSERT INTO benchmarks (track_id, class, condition, alien_time, competitive_time, good_time,
         good_102_time, midpack_time, midpack_104_time, tail_ender_time, offline_time, data_readiness_pct, patch_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        b.track_id,
        b.class,
        b.condition,
        b.alien_time,
        b.competitive_time,
        b.good_time,
        b.good_102_time ?? null,
        b.midpack_time,
        b.midpack_104_time ?? null,
        b.tail_ender_time,
        b.offline_time,
        b.data_readiness_pct,
        b.patch_version ?? null,
      ],
    );
    return rowToBenchmark(res.rows[0]);
  }

  // recommendations -----------------------------------------------------------
  async listRecommendations(
    filter: { track_id?: number; class?: RacingClass; condition?: Condition } = {},
  ): Promise<Recommendation[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.track_id != null) { params.push(filter.track_id); where.push(`track_id = $${params.length}`); }
    if (filter.class != null) { params.push(filter.class); where.push(`class = $${params.length}`); }
    if (filter.condition != null) { params.push(filter.condition); where.push(`condition = $${params.length}`); }
    const sql = `SELECT * FROM recommendations ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY car_score DESC`;
    const res = await this.q(sql, params);
    return res.rows.map(rowToRecommendation);
  }

  async upsertRecommendation(r: NewRecommendation): Promise<Recommendation> {
    const res = await this.q(
      `INSERT INTO recommendations
         (car_id, track_id, class, condition, car_score, pace_factor, consistency_factor,
          tyre_factor, drivability_factor, mistakes_factor, sessions_used, session_ids, confidence_score, weights_preset, best_setup)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (car_id, track_id, class, condition) DO UPDATE SET
         car_score=EXCLUDED.car_score, pace_factor=EXCLUDED.pace_factor,
         consistency_factor=EXCLUDED.consistency_factor, tyre_factor=EXCLUDED.tyre_factor,
         drivability_factor=EXCLUDED.drivability_factor, mistakes_factor=EXCLUDED.mistakes_factor,
         sessions_used=EXCLUDED.sessions_used, session_ids=EXCLUDED.session_ids,
         confidence_score=EXCLUDED.confidence_score, weights_preset=EXCLUDED.weights_preset,
         best_setup=EXCLUDED.best_setup, last_updated=CURRENT_TIMESTAMP
       RETURNING *`,
      [r.car_id, r.track_id, r.class, r.condition, r.car_score, r.pace_factor, r.consistency_factor, r.tyre_factor, r.drivability_factor, r.mistakes_factor, r.sessions_used, JSON.stringify(r.session_ids), r.confidence_score, r.weights_preset ?? null, r.best_setup ?? null],
    );
    return rowToRecommendation(res.rows[0]);
  }

  async clearRecommendations(): Promise<void> {
    await this.q("DELETE FROM recommendations");
  }

  // settings ------------------------------------------------------------------
  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const res = await this.q("SELECT value FROM settings WHERE key = $1", [key]);
    return res.rows[0] ? (res.rows[0].value as T) : null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.q(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(value)],
    );
  }

  // eras ----------------------------------------------------------------------
  private era(r: any): Era {
    return {
      id: r.id,
      name: r.name,
      starts_at: iso(r.starts_at),
      reason: r.reason ?? null,
      created_by: r.created_by ?? null,
      created_at: iso(r.created_at),
    };
  }

  async listEras(): Promise<Era[]> {
    const res = await this.q("SELECT * FROM eras ORDER BY starts_at ASC, id ASC");
    return res.rows.map((r) => this.era(r));
  }

  async createEra(input: NewEraInput & { starts_at: string }): Promise<Era> {
    const res = await this.q(
      "INSERT INTO eras (name, starts_at, reason, created_by) VALUES ($1,$2,$3,$4) RETURNING *",
      [input.name, input.starts_at, input.reason ?? null, input.created_by ?? null],
    );
    return this.era(res.rows[0]);
  }

  async deleteEra(id: number): Promise<boolean> {
    const res = await this.q("DELETE FROM eras WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async purgeSessions(): Promise<number> {
    // tyres cascade via FK; recommendations cleared so the board empties too.
    const res = await this.q("DELETE FROM sessions");
    await this.q("DELETE FROM recommendations");
    return res.rowCount ?? 0;
  }

  // races ---------------------------------------------------------------------
  async listRaces(): Promise<RaceEvent[]> {
    const res = await this.q("SELECT * FROM races ORDER BY event_date ASC, id ASC");
    return res.rows.map(rowToRace);
  }

  async getRace(id: number): Promise<RaceEvent | null> {
    const res = await this.q("SELECT * FROM races WHERE id = $1", [id]);
    return res.rows[0] ? rowToRace(res.rows[0]) : null;
  }

  async createRace(input: NewRaceInput): Promise<RaceEvent> {
    const res = await this.q(
      `INSERT INTO races (track_id, class, condition, name, event_date, start_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.track_id, input.class ?? null, input.condition ?? null, input.name ?? null, input.event_date, input.start_at ?? null, input.created_by ?? null],
    );
    return rowToRace(res.rows[0]);
  }

  async updateRace(id: number, patch: RacePatch): Promise<RaceEvent | null> {
    const cols: (keyof RacePatch)[] = ["track_id", "class", "condition", "name", "event_date", "start_at", "note", "note_by"];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of cols) {
      if (col in patch) { params.push((patch as any)[col]); sets.push(`${col} = $${params.length}`); }
    }
    if ("note" in patch) sets.push("note_updated_at = CURRENT_TIMESTAMP");
    if (sets.length === 0) return this.getRace(id);
    params.push(id);
    const res = await this.q(`UPDATE races SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
    return res.rows[0] ? rowToRace(res.rows[0]) : null;
  }

  async deleteRace(id: number): Promise<boolean> {
    const res = await this.q("DELETE FROM races WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // test requests -------------------------------------------------------------
  async listTestRequests(): Promise<TestRequest[]> {
    const res = await this.q("SELECT * FROM test_requests ORDER BY created_at DESC, id DESC");
    return res.rows.map(rowToTestRequest);
  }

  async createTestRequest(input: NewTestRequestInput): Promise<TestRequest> {
    const res = await this.q(
      `INSERT INTO test_requests (car_id, track_id, condition, note, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [input.car_id, input.track_id, input.condition, input.note ?? null, input.created_by ?? null],
    );
    return rowToTestRequest(res.rows[0]);
  }

  async deleteTestRequest(id: number): Promise<boolean> {
    const res = await this.q("DELETE FROM test_requests WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // race results (prediction accuracy) -----------------------------------------
  async listRaceResults(): Promise<RaceResult[]> {
    const res = await this.q("SELECT * FROM race_results ORDER BY raced_on DESC, id DESC");
    return res.rows.map(rowToRaceResult);
  }

  async createRaceResult(input: NewRaceResultInput): Promise<RaceResult> {
    const res = await this.q(
      `INSERT INTO race_results (track_id, class, raced_on, recommended_car_id, raced_car_id, verdict, position, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        input.track_id,
        input.class,
        input.raced_on,
        input.recommended_car_id ?? null,
        input.raced_car_id,
        input.verdict,
        input.position ?? null,
        input.note ?? null,
        input.created_by ?? null,
      ],
    );
    return rowToRaceResult(res.rows[0]);
  }

  async deleteRaceResult(id: number): Promise<boolean> {
    const res = await this.q("DELETE FROM race_results WHERE id = $1", [id]);
    return (res.rowCount ?? 0) > 0;
  }

  // meta ----------------------------------------------------------------------
  async counts() {
    const tables = ["drivers", "cars", "tracks", "sessions", "benchmarks", "recommendations"] as const;
    const out: Record<string, number> = {};
    for (const t of tables) {
      const res = await this.q(`SELECT COUNT(*)::int AS n FROM ${t}`);
      out[t] = res.rows[0]?.n ?? 0;
    }
    return out as { drivers: number; cars: number; tracks: number; sessions: number; benchmarks: number; recommendations: number };
  }
}
