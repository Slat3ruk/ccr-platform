// ============================================================================
// Store interface — the contract both the JSON dev store and the Postgres
// production store implement. The API routes and scoring service depend only
// on this interface, never on a concrete backend.
// ============================================================================

import type {
  Benchmark,
  Car,
  CarCategory,
  Condition,
  Driver,
  NewRaceInput,
  RaceEvent,
  RacingClass,
  Recommendation,
  Session,
  SessionType,
  Track,
  ValueComponents,
} from "@/types";

export interface NewSessionRecord {
  driver_id: number;
  car_id: number;
  track_id: number;
  session_type: SessionType;
  condition_reported: Condition;
  patch_version?: string | null;
  lap_count: number;
  best_lap_time: number;
  avg_lap_time: number;
  off_track_count: number;
  off_track_penalty_points: number;
  confidence_rating: number;
  setup_version?: string | null;
  comments?: string | null;
  tyre_fl_pct_remaining: number;
  tyre_fr_pct_remaining: number;
  tyre_rl_pct_remaining: number;
  tyre_rr_pct_remaining: number;
}

export interface SessionFilter {
  car_id?: number;
  track_id?: number;
  driver_id?: number;
  limit?: number;
}

export interface NewBenchmark {
  track_id: number;
  class: RacingClass;
  condition: Condition;
  alien_time: number;
  competitive_time: number;
  good_time: number;
  midpack_time: number;
  tail_ender_time: number;
  offline_time: number;
  data_readiness_pct: number;
  patch_version?: string | null;
}

export interface NewRecommendation {
  car_id: number;
  track_id: number;
  class: RacingClass;
  condition: Condition;
  car_score: number;
  pace_factor: number;
  consistency_factor: number;
  tyre_factor: number;
  drivability_factor: number;
  mistakes_factor: number;
  sessions_used: number;
  session_ids: number[];
  confidence_score: number;
  weights_preset?: string | null;
}

/** Fields patchable on a race event (all optional; only present keys change). */
export interface RacePatch {
  track_id?: number;
  class?: RacingClass | null;
  condition?: Condition | null;
  name?: string | null;
  event_date?: string;
  note?: string | null;
  note_by?: string | null;
}

export interface Store {
  /** Backend label for diagnostics: "postgres" | "json". */
  readonly kind: string;
  /** Create tables / files if missing. */
  init(): Promise<void>;

  // drivers
  getOrCreateDriver(name: string): Promise<Driver>;
  listDrivers(): Promise<Driver[]>;

  // cars
  listCars(): Promise<Car[]>;
  getCar(id: number): Promise<Car | null>;
  createCar(name: string, category: CarCategory): Promise<Car>;

  // tracks
  listTracks(): Promise<Track[]>;
  getTrack(id: number): Promise<Track | null>;
  createTrack(name: string, layout_id?: string | null, country?: string | null): Promise<Track>;

  // sessions
  createSession(rec: NewSessionRecord): Promise<Session>;
  getSession(id: number): Promise<Session | null>;
  listSessions(filter?: SessionFilter): Promise<Session[]>;
  updateSession(id: number, patch: Partial<NewSessionRecord>): Promise<Session | null>;
  deleteSession(id: number): Promise<boolean>;
  setSessionValue(id: number, svs: number, components: ValueComponents): Promise<void>;

  // benchmarks
  listBenchmarks(): Promise<Benchmark[]>;
  getBenchmark(track_id: number, cls: RacingClass, condition: Condition): Promise<Benchmark | null>;
  upsertBenchmark(b: NewBenchmark): Promise<Benchmark>;

  // recommendations
  listRecommendations(filter?: { track_id?: number; class?: RacingClass; condition?: Condition }): Promise<Recommendation[]>;
  upsertRecommendation(r: NewRecommendation): Promise<Recommendation>;
  clearRecommendations(): Promise<void>;

  // settings (key/value — e.g. the active weighting preset)
  getSetting<T = unknown>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;

  // races (calendar + BLUF briefing note)
  listRaces(): Promise<RaceEvent[]>;
  getRace(id: number): Promise<RaceEvent | null>;
  createRace(input: NewRaceInput): Promise<RaceEvent>;
  updateRace(id: number, patch: RacePatch): Promise<RaceEvent | null>;
  deleteRace(id: number): Promise<boolean>;

  // meta
  counts(): Promise<{ drivers: number; cars: number; tracks: number; sessions: number; benchmarks: number; recommendations: number }>;
}
