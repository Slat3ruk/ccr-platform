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
  RacingClass,
  Recommendation,
  Session,
  Track,
  ValueComponents,
} from "@/types";
import type {
  NewBenchmark,
  NewRecommendation,
  NewSessionRecord,
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
    setup_version: r.setup_version,
    svm_data: r.svm_data,
    comments: r.comments,
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
    midpack_time: Number(r.midpack_time),
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
    last_updated: iso(r.last_updated),
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
    return res.rows.map((r) => ({ id: r.id, name: r.name, layout_id: r.layout_id, country: r.country, created_at: iso(r.created_at) }));
  }

  async getTrack(id: number): Promise<Track | null> {
    const res = await this.q("SELECT * FROM tracks WHERE id = $1", [id]);
    const r = res.rows[0];
    return r ? { id: r.id, name: r.name, layout_id: r.layout_id, country: r.country, created_at: iso(r.created_at) } : null;
  }

  async createTrack(name: string, layout_id: string | null = null, country: string | null = null): Promise<Track> {
    const res = await this.q(
      "INSERT INTO tracks (name, layout_id, country) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET layout_id = EXCLUDED.layout_id RETURNING *",
      [name, layout_id, country],
    );
    const r = res.rows[0];
    return { id: r.id, name: r.name, layout_id: r.layout_id, country: r.country, created_at: iso(r.created_at) };
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
           confidence_rating, setup_version, comments)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [
          rec.driver_id, rec.car_id, rec.track_id, rec.session_type, rec.condition_reported, rec.patch_version ?? null,
          rec.lap_count, rec.best_lap_time, rec.avg_lap_time, rec.off_track_count, rec.off_track_penalty_points,
          rec.confidence_rating, rec.setup_version ?? null, rec.comments ?? null,
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
      "confidence_rating", "setup_version", "comments",
    ];
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const col of sessionCols) {
      if (col in patch) { params.push((patch as any)[col]); sets.push(`${col} = $${params.length}`); }
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
        `UPDATE benchmarks SET alien_time=$1, competitive_time=$2, good_time=$3, midpack_time=$4,
           tail_ender_time=$5, offline_time=$6, data_readiness_pct=$7, patch_version=$8,
           last_synced_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING *`,
        [b.alien_time, b.competitive_time, b.good_time, b.midpack_time, b.tail_ender_time, b.offline_time, b.data_readiness_pct, b.patch_version ?? null, existing.rows[0].id],
      );
      return rowToBenchmark(res.rows[0]);
    }
    const res = await this.q(
      `INSERT INTO benchmarks (track_id, class, condition, alien_time, competitive_time, good_time,
         midpack_time, tail_ender_time, offline_time, data_readiness_pct, patch_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [b.track_id, b.class, b.condition, b.alien_time, b.competitive_time, b.good_time, b.midpack_time, b.tail_ender_time, b.offline_time, b.data_readiness_pct, b.patch_version ?? null],
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
          tyre_factor, drivability_factor, mistakes_factor, sessions_used, session_ids, confidence_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (car_id, track_id, class, condition) DO UPDATE SET
         car_score=EXCLUDED.car_score, pace_factor=EXCLUDED.pace_factor,
         consistency_factor=EXCLUDED.consistency_factor, tyre_factor=EXCLUDED.tyre_factor,
         drivability_factor=EXCLUDED.drivability_factor, mistakes_factor=EXCLUDED.mistakes_factor,
         sessions_used=EXCLUDED.sessions_used, session_ids=EXCLUDED.session_ids,
         confidence_score=EXCLUDED.confidence_score, last_updated=CURRENT_TIMESTAMP
       RETURNING *`,
      [r.car_id, r.track_id, r.class, r.condition, r.car_score, r.pace_factor, r.consistency_factor, r.tyre_factor, r.drivability_factor, r.mistakes_factor, r.sessions_used, JSON.stringify(r.session_ids), r.confidence_score],
    );
    return rowToRecommendation(res.rows[0]);
  }

  async clearRecommendations(): Promise<void> {
    await this.q("DELETE FROM recommendations");
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
