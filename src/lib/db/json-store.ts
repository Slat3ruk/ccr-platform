// ============================================================================
// JSON file store — the zero-config default used when DATABASE_URL is unset.
// Persists to .data/store.json. Single-process (next dev) only; production
// uses the Postgres store. Writes are serialized through a promise chain.
// ============================================================================

import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  Benchmark,
  Car,
  CarCategory,
  Condition,
  Driver,
  Era,
  NewEraInput,
  NewRaceInput,
  RaceEvent,
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
  RacePatch,
  SessionFilter,
  Store,
} from "./types";

interface RawSession extends Omit<Session, "tyres"> {
  tyre_fl_pct_remaining: number;
  tyre_fr_pct_remaining: number;
  tyre_rl_pct_remaining: number;
  tyre_rr_pct_remaining: number;
}

interface DbShape {
  seq: Record<string, number>;
  drivers: Driver[];
  cars: Car[];
  tracks: Track[];
  sessions: RawSession[];
  benchmarks: Benchmark[];
  recommendations: Recommendation[];
  settings: Record<string, unknown>;
  races: RaceEvent[];
  eras: Era[];
}

function emptyDb(): DbShape {
  return {
    seq: { drivers: 0, cars: 0, tracks: 0, sessions: 0, benchmarks: 0, recommendations: 0, races: 0, eras: 0 },
    drivers: [],
    cars: [],
    tracks: [],
    sessions: [],
    benchmarks: [],
    recommendations: [],
    settings: {},
    races: [],
    eras: [],
  };
}

function withTyres(s: RawSession): Session {
  const avg_wear_pct =
    100 -
    (s.tyre_fl_pct_remaining + s.tyre_fr_pct_remaining + s.tyre_rl_pct_remaining + s.tyre_rr_pct_remaining) / 4;
  const { tyre_fl_pct_remaining, tyre_fr_pct_remaining, tyre_rl_pct_remaining, tyre_rr_pct_remaining, ...rest } = s;
  return {
    ...rest,
    tyres: {
      tyre_fl_pct_remaining,
      tyre_fr_pct_remaining,
      tyre_rl_pct_remaining,
      tyre_rr_pct_remaining,
      avg_wear_pct: Math.round(avg_wear_pct * 100) / 100,
    },
  };
}

export class JsonStore implements Store {
  readonly kind = "json";
  private file: string;
  private db: DbShape = emptyDb();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  // Data dir resolves to CCR_DATA_DIR if set, else <cwd>/.data. The env override
  // keeps the store anchored to the app even when the process is spawned with a
  // different cwd (e.g. a dev/preview launcher), instead of scattering .data/.
  constructor(dir = process.env.CCR_DATA_DIR ?? path.join(process.cwd(), ".data")) {
    this.file = path.join(dir, "store.json");
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    try {
      const txt = await fs.readFile(this.file, "utf8");
      this.db = { ...emptyDb(), ...(JSON.parse(txt) as DbShape) };
    } catch {
      this.db = emptyDb();
      await this.persist();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.db, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, snapshot, "utf8");
    });
    return this.writeChain;
  }

  private nextId(coll: keyof DbShape["seq"]): number {
    this.db.seq[coll] = (this.db.seq[coll] ?? 0) + 1;
    return this.db.seq[coll];
  }

  private now(): string {
    return new Date().toISOString();
  }

  // drivers -------------------------------------------------------------------
  async getOrCreateDriver(name: string): Promise<Driver> {
    await this.init();
    const existing = this.db.drivers.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const driver: Driver = {
      id: this.nextId("drivers"),
      name,
      discord_id: null,
      role: "driver",
      trust_score: 1.0,
      created_at: this.now(),
      updated_at: this.now(),
    };
    this.db.drivers.push(driver);
    await this.persist();
    return driver;
  }

  async listDrivers(): Promise<Driver[]> {
    await this.init();
    return [...this.db.drivers];
  }

  // cars ----------------------------------------------------------------------
  async listCars(): Promise<Car[]> {
    await this.init();
    return [...this.db.cars].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getCar(id: number): Promise<Car | null> {
    await this.init();
    return this.db.cars.find((c) => c.id === id) ?? null;
  }

  async createCar(name: string, category: CarCategory): Promise<Car> {
    await this.init();
    const existing = this.db.cars.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const car: Car = { id: this.nextId("cars"), name, category, created_at: this.now() };
    this.db.cars.push(car);
    await this.persist();
    return car;
  }

  // tracks --------------------------------------------------------------------
  async listTracks(): Promise<Track[]> {
    await this.init();
    return [...this.db.tracks].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTrack(id: number): Promise<Track | null> {
    await this.init();
    return this.db.tracks.find((t) => t.id === id) ?? null;
  }

  async createTrack(name: string, layout_id: string | null = null, country: string | null = null): Promise<Track> {
    await this.init();
    const existing = this.db.tracks.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const track: Track = { id: this.nextId("tracks"), name, layout_id, country, created_at: this.now() };
    this.db.tracks.push(track);
    await this.persist();
    return track;
  }

  // sessions ------------------------------------------------------------------
  async createSession(rec: NewSessionRecord): Promise<Session> {
    await this.init();
    const raw: RawSession = {
      id: this.nextId("sessions"),
      driver_id: rec.driver_id,
      car_id: rec.car_id,
      track_id: rec.track_id,
      session_type: rec.session_type,
      condition_reported: rec.condition_reported,
      patch_version: rec.patch_version ?? null,
      lap_count: rec.lap_count,
      best_lap_time: rec.best_lap_time,
      avg_lap_time: rec.avg_lap_time,
      off_track_count: rec.off_track_count,
      off_track_penalty_points: rec.off_track_penalty_points,
      confidence_rating: rec.confidence_rating,
      setup_type: rec.setup_type ?? null,
      setup_version: rec.setup_version ?? null,
      svm_data: null,
      comments: rec.comments ?? null,
      lap_times: rec.lap_times ?? null,
      session_value_score: null,
      value_components: null,
      created_at: this.now(),
      updated_at: this.now(),
      tyre_fl_pct_remaining: rec.tyre_fl_pct_remaining,
      tyre_fr_pct_remaining: rec.tyre_fr_pct_remaining,
      tyre_rl_pct_remaining: rec.tyre_rl_pct_remaining,
      tyre_rr_pct_remaining: rec.tyre_rr_pct_remaining,
    };
    this.db.sessions.push(raw);
    await this.persist();
    return withTyres(raw);
  }

  async getSession(id: number): Promise<Session | null> {
    await this.init();
    const s = this.db.sessions.find((x) => x.id === id);
    return s ? withTyres(s) : null;
  }

  async listSessions(filter: SessionFilter = {}): Promise<Session[]> {
    await this.init();
    let rows = [...this.db.sessions];
    if (filter.car_id != null) rows = rows.filter((s) => s.car_id === filter.car_id);
    if (filter.track_id != null) rows = rows.filter((s) => s.track_id === filter.track_id);
    if (filter.driver_id != null) rows = rows.filter((s) => s.driver_id === filter.driver_id);
    rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
    if (filter.limit != null) rows = rows.slice(0, filter.limit);
    return rows.map(withTyres);
  }

  async updateSession(id: number, patch: Partial<NewSessionRecord>): Promise<Session | null> {
    await this.init();
    const s = this.db.sessions.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, patch, { updated_at: this.now() });
    await this.persist();
    return withTyres(s);
  }

  async deleteSession(id: number): Promise<boolean> {
    await this.init();
    const before = this.db.sessions.length;
    this.db.sessions = this.db.sessions.filter((s) => s.id !== id);
    const removed = this.db.sessions.length < before;
    if (removed) await this.persist();
    return removed;
  }

  async setSessionValue(id: number, svs: number, components: ValueComponents): Promise<void> {
    await this.init();
    const s = this.db.sessions.find((x) => x.id === id);
    if (!s) return;
    s.session_value_score = svs;
    s.value_components = components;
    await this.persist();
  }

  // benchmarks ----------------------------------------------------------------
  async listBenchmarks(): Promise<Benchmark[]> {
    await this.init();
    return [...this.db.benchmarks];
  }

  async getBenchmark(track_id: number, cls: RacingClass, condition: Condition): Promise<Benchmark | null> {
    await this.init();
    return (
      this.db.benchmarks.find((b) => b.track_id === track_id && b.class === cls && b.condition === condition) ?? null
    );
  }

  async upsertBenchmark(b: NewBenchmark): Promise<Benchmark> {
    await this.init();
    const existing = this.db.benchmarks.find(
      (x) => x.track_id === b.track_id && x.class === b.class && x.condition === b.condition,
    );
    if (existing) {
      Object.assign(existing, b, { last_synced_at: this.now() });
      await this.persist();
      return existing;
    }
    const row: Benchmark = { id: this.nextId("benchmarks"), ...b, patch_version: b.patch_version ?? null, last_synced_at: this.now() };
    this.db.benchmarks.push(row);
    await this.persist();
    return row;
  }

  // recommendations -----------------------------------------------------------
  async listRecommendations(
    filter: { track_id?: number; class?: RacingClass; condition?: Condition } = {},
  ): Promise<Recommendation[]> {
    await this.init();
    let rows = [...this.db.recommendations];
    if (filter.track_id != null) rows = rows.filter((r) => r.track_id === filter.track_id);
    if (filter.class != null) rows = rows.filter((r) => r.class === filter.class);
    if (filter.condition != null) rows = rows.filter((r) => r.condition === filter.condition);
    rows.sort((a, b) => b.car_score - a.car_score);
    return rows;
  }

  async upsertRecommendation(r: NewRecommendation): Promise<Recommendation> {
    await this.init();
    const existing = this.db.recommendations.find(
      (x) => x.car_id === r.car_id && x.track_id === r.track_id && x.class === r.class && x.condition === r.condition,
    );
    if (existing) {
      Object.assign(existing, r, { last_updated: this.now() });
      await this.persist();
      return existing;
    }
    const row: Recommendation = { id: this.nextId("recommendations"), ...r, last_updated: this.now() };
    this.db.recommendations.push(row);
    await this.persist();
    return row;
  }

  async clearRecommendations(): Promise<void> {
    await this.init();
    this.db.recommendations = [];
    await this.persist();
  }

  // settings ------------------------------------------------------------------
  async getSetting<T = unknown>(key: string): Promise<T | null> {
    await this.init();
    return (this.db.settings[key] as T) ?? null;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.init();
    this.db.settings[key] = value;
    await this.persist();
  }

  // eras ----------------------------------------------------------------------
  async listEras(): Promise<Era[]> {
    await this.init();
    return [...this.db.eras].sort(
      (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id - b.id,
    );
  }

  async createEra(input: NewEraInput & { starts_at: string }): Promise<Era> {
    await this.init();
    const era: Era = {
      id: this.nextId("eras"),
      name: input.name,
      starts_at: input.starts_at,
      reason: input.reason ?? null,
      created_by: input.created_by ?? null,
      created_at: this.now(),
    };
    this.db.eras.push(era);
    await this.persist();
    return era;
  }

  async deleteEra(id: number): Promise<boolean> {
    await this.init();
    const before = this.db.eras.length;
    this.db.eras = this.db.eras.filter((e) => e.id !== id);
    const removed = this.db.eras.length < before;
    if (removed) await this.persist();
    return removed;
  }

  async purgeSessions(): Promise<number> {
    await this.init();
    const removed = this.db.sessions.length;
    this.db.sessions = [];
    this.db.recommendations = [];
    await this.persist();
    return removed;
  }

  // races ---------------------------------------------------------------------
  async listRaces(): Promise<RaceEvent[]> {
    await this.init();
    return [...this.db.races].sort(
      (a, b) => a.event_date.localeCompare(b.event_date) || a.id - b.id,
    );
  }

  async getRace(id: number): Promise<RaceEvent | null> {
    await this.init();
    return this.db.races.find((r) => r.id === id) ?? null;
  }

  async createRace(input: NewRaceInput): Promise<RaceEvent> {
    await this.init();
    const race: RaceEvent = {
      id: this.nextId("races"),
      track_id: input.track_id,
      class: input.class ?? null,
      condition: input.condition ?? null,
      name: input.name ?? null,
      event_date: input.event_date,
      note: null,
      note_by: null,
      note_updated_at: null,
      created_by: input.created_by ?? null,
      created_at: this.now(),
    };
    this.db.races.push(race);
    await this.persist();
    return race;
  }

  async updateRace(id: number, patch: RacePatch): Promise<RaceEvent | null> {
    await this.init();
    const race = this.db.races.find((r) => r.id === id);
    if (!race) return null;
    Object.assign(race, patch);
    if ("note" in patch) race.note_updated_at = this.now();
    await this.persist();
    return race;
  }

  async deleteRace(id: number): Promise<boolean> {
    await this.init();
    const before = this.db.races.length;
    this.db.races = this.db.races.filter((r) => r.id !== id);
    const removed = this.db.races.length < before;
    if (removed) await this.persist();
    return removed;
  }

  // meta ----------------------------------------------------------------------
  async counts() {
    await this.init();
    return {
      drivers: this.db.drivers.length,
      cars: this.db.cars.length,
      tracks: this.db.tracks.length,
      sessions: this.db.sessions.length,
      benchmarks: this.db.benchmarks.length,
      recommendations: this.db.recommendations.length,
    };
  }
}
