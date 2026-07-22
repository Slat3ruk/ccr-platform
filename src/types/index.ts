// ============================================================================
// CrossCurrent Racing Platform — shared TypeScript contracts
// These types are the single source of truth shared by the data layer, the
// scoring engine, the API route handlers, and the React UI.
// ============================================================================

// --- Enumerations ------------------------------------------------------------

/** Physical car category (stored on the `cars` row). */
export type CarCategory = "Hypercar" | "GT3" | "LMP2" | "LMP3";

/** Benchmark / ranking class. LMP2 splits into ELMS / WEC spec sheets. */
export type RacingClass = "LMGT3" | "LMH" | "LMP3" | "LMP2-ELMS" | "LMP2-WEC";

export type SessionType = "Practice" | "Quali" | "Race";
export type Condition = "Dry" | "Wet" | "Mixed";
export type DriverRole = "driver" | "engineer" | "admin";

export const CAR_CATEGORIES: CarCategory[] = ["Hypercar", "GT3", "LMP2", "LMP3"];
export const RACING_CLASSES: RacingClass[] = ["LMGT3", "LMH", "LMP3", "LMP2-ELMS", "LMP2-WEC"];
export const SESSION_TYPES: SessionType[] = ["Practice", "Quali", "Race"];
export const CONDITIONS: Condition[] = ["Dry", "Wet", "Mixed"];

/**
 * The setup provider ships one fixed set of setups per car+track+game-version,
 * spanning a purpose (Quali / Race / Endurance) × trim (Esport / Safe / Wet)
 * matrix. This is the canonical 7 — a controlled enum so `setup_type` can never
 * be misspelled (the whole problem free-text `setup_version` had). `code` is the
 * provider's shorthand (doc: "E R"; their filenames: "R Esport" — same thing).
 * The specific pack/game version a driver ran is captured separately in the
 * free-text `setup_version`, since that string drifts and is only interpreted
 * later (staleness flag).
 */
export const SETUP_TYPES: { value: string; code: string }[] = [
  { value: "Race · Esport", code: "E R" },
  { value: "Quali · Esport", code: "E Q" },
  { value: "Race · Safe", code: "S R" },
  { value: "Quali · Safe", code: "S Q" },
  { value: "Race · Wet", code: "WET R" },
  { value: "Quali · Wet", code: "WET Q" },
  { value: "Endurance", code: "Endu" },
  // In-game default setups — poor baselines, but some drivers run them, so track it.
  { value: "LMU Default", code: "LMU" },
  { value: "Coach Dave Default", code: "CDA" },
];

/**
 * Maps a car's physical category to the benchmark class used for pace
 * comparison and dashboard grouping. LMP2 defaults to the ELMS sheet; a
 * session can override via its own class field if WEC pace is wanted.
 */
export function categoryToClass(category: CarCategory): RacingClass {
  switch (category) {
    case "GT3":
      return "LMGT3";
    case "Hypercar":
      return "LMH";
    case "LMP3":
      return "LMP3";
    case "LMP2":
      return "LMP2-ELMS";
  }
}

// --- Entities (mirror the DB rows) -------------------------------------------

export interface Driver {
  id: number;
  name: string;
  discord_id?: string | null;
  role: DriverRole;
  trust_score: number;
  created_at: string;
  updated_at: string;
}

export interface Car {
  id: number;
  name: string;
  category: CarCategory;
  created_at: string;
}

export interface Track {
  id: number;
  name: string;
  layout_id?: string | null;
  country?: string | null;
  /** Lap distance in km. Null until entered — sync-created tracks have none. */
  length_km?: number | null;
  created_at: string;
}

/** Editable fields on a track (control panel). Omitted keys are left alone. */
export interface TrackPatch {
  name?: string;
  layout_id?: string | null;
  country?: string | null;
  length_km?: number | null;
}

export interface TyreData {
  tyre_fl_pct_remaining: number;
  tyre_fr_pct_remaining: number;
  tyre_rl_pct_remaining: number;
  tyre_rr_pct_remaining: number;
  /** computed: 100 - avg(remaining) */
  avg_wear_pct: number;
}

export interface ValueComponents {
  completeness: number;
  consistency: number;
  cleanliness: number;
  representativeness: number;
  recency: number;
}

export interface Session {
  id: number;
  driver_id: number;
  car_id: number;
  track_id: number;
  session_type: SessionType;
  condition_reported: Condition;
  patch_version?: string | null;
  lap_count: number;
  /** seconds */
  best_lap_time: number;
  /** seconds */
  avg_lap_time: number;
  off_track_count: number;
  off_track_penalty_points: number;
  confidence_rating: number;
  /** Controlled setup family (one of SETUP_TYPES). The grouping key for best-setup. */
  setup_type?: string | null;
  /** Free-text pack/game version the driver ran (e.g. "1.3.3", "GMR001"). Captured, not yet interpreted. */
  setup_version?: string | null;
  svm_data?: unknown;
  comments?: string | null;
  /** Optional individual lap times (seconds). When present (≥2 laps), consistency uses true std-dev. */
  lap_times?: number[] | null;
  /**
   * Litres of fuel used per lap. Not scored — captured for the future strategy
   * calculator, which can't reconstruct it after the fact.
   */
  fuel_per_lap?: number | null;
  /** % of Virtual Energy used per lap. Hypercar + GT3 only; LMP2/LMP3 have no VE. */
  ve_per_lap?: number | null;
  session_value_score?: number | null;
  value_components?: ValueComponents | null;
  created_at: string;
  updated_at: string;
  // joined / embedded
  tyres: TyreData;
}

export interface Benchmark {
  id: number;
  track_id: number;
  class: RacingClass;
  condition: Condition;
  alien_time: number;
  competitive_time: number;
  /** Slower edge of the "Good" band (103%) — used as the scoring threshold. */
  good_time: number;
  /** Faster edge of the "Good" band (102%), display-only. Null until synced. */
  good_102_time: number | null;
  /** Slower edge of the "Midpack" band (105%) — used as the scoring threshold. */
  midpack_time: number;
  /** Faster edge of the "Midpack" band (104%), display-only. Null until synced. */
  midpack_104_time: number | null;
  tail_ender_time: number;
  offline_time: number;
  data_readiness_pct: number;
  patch_version?: string | null;
  last_synced_at: string;
}

export interface Recommendation {
  id: number;
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
  /** Name of the weighting preset this score was computed under (transparency). */
  weights_preset?: string | null;
  /** The setup_version that produced this score (best qualifying setup), or null when blended. */
  best_setup?: string | null;
  last_updated: string;
}

// --- DTOs (input/output shapes at the API boundary) --------------------------

/** Payload accepted by POST /api/sessions (driver name resolved to id). */
export interface SessionInput {
  driver_name: string;
  car_id: number;
  track_id: number;
  session_type: SessionType;
  condition_reported: Condition;
  patch_version?: string;
  lap_count: number;
  best_lap_time: number; // seconds
  avg_lap_time: number; // seconds
  off_track_count: number;
  confidence_rating: number;
  setup_type?: string;
  setup_version?: string;
  comments?: string;
  /** Optional individual lap times (seconds), already parsed by the form. */
  lap_times?: number[];
  /** Litres per lap (optional). Reference data for the strategy calculator. */
  fuel_per_lap?: number;
  /** VE % per lap (optional). Hypercar + GT3 only. */
  ve_per_lap?: number;
  /**
   * Set only on a deliberate re-send after the server flagged a suspected
   * double-submit (409). Skips that check — see lib/duplicates.ts.
   */
  confirm_duplicate?: boolean;
  tyre_fl_pct_remaining: number;
  tyre_fr_pct_remaining: number;
  tyre_rl_pct_remaining: number;
  tyre_rr_pct_remaining: number;
}

/** The five 0-100 factor scores for a single session. */
export interface FactorScores {
  pace: number;
  consistency: number;
  tyre: number;
  drivability: number;
  mistakes: number;
}

// --- Car-Score weighting (adjustable factor weights) -------------------------

/** The five Car-Score factor weights. Should sum to 1.0 (normalised on apply). */
export interface FactorWeights {
  pace: number;
  consistency: number;
  tyre: number;
  drivability: number;
  mistakes: number;
}

/**
 * The globally-active weighting: a named preset ("Balanced", "Pace-focused",
 * "Tyre-saver", "Sprint", or "Custom") plus the concrete weights it resolves to.
 * Persisted in the store's settings; every recompute reads it so the ranking is
 * one shared, mathematically-consistent list. The preset name is stamped onto
 * each recommendation for transparency (the Discord-style tag in the table).
 */
export interface WeightsConfig {
  preset: string;
  weights: FactorWeights;
}

// --- Data eras ("line in the sand") -------------------------------------------

/**
 * An era is a named boundary in time — typically drawn when an LMU patch/BoP
 * change makes older data non-comparable. Sessions are assigned by timestamp
 * (created_at >= starts_at, until the next era begins); nothing is deleted, so
 * old eras stay recallable. Live rankings score only the current era.
 */
export interface Era {
  id: number;
  name: string;
  /** ISO timestamp the era begins. */
  starts_at: string;
  /** Why the line was drawn (e.g. "Patch 1.4 BoP"). */
  reason?: string | null;
  created_by?: string | null;
  created_at: string;
}

/** Payload accepted by POST /api/eras. */
export interface NewEraInput {
  name: string;
  /** ISO timestamp; defaults to "now" server-side. */
  starts_at?: string;
  reason?: string | null;
  created_by?: string | null;
}

// --- Race calendar + BLUF briefing -------------------------------------------

/**
 * A manually-added race weekend. `event_date` is the main race day (typically
 * Saturday); the briefing page features it from a few days before through the
 * day after. `note` is the engineer/manager BLUF announcement.
 */
export interface RaceEvent {
  id: number;
  track_id: number;
  class?: RacingClass | null;
  condition?: Condition | null;
  name?: string | null;
  /** ISO date (YYYY-MM-DD) of the main race day. */
  event_date: string;
  /**
   * Optional absolute start instant (full ISO UTC timestamp). Stored in UTC so
   * every viewer's browser renders it in THEIR local time via toLocaleString —
   * a UK manager sets 19:00, a German driver sees 20:00. Null = day-only (TBC).
   */
  start_at?: string | null;
  note?: string | null;
  note_by?: string | null;
  note_updated_at?: string | null;
  created_by?: string | null;
  created_at: string;
}

/** Payload accepted by POST /api/races. */
export interface NewRaceInput {
  track_id: number;
  class?: RacingClass | null;
  condition?: Condition | null;
  name?: string | null;
  event_date: string;
  /** Optional full ISO UTC start instant (the form converts the manager's local time). */
  start_at?: string | null;
  created_by?: string | null;
}

/** A race event joined with its track name for the briefing/calendar UI. */
export interface RaceRow extends RaceEvent {
  track_name: string;
}

// --- Test requests (coverage v2) ---------------------------------------------

/**
 * A manager's "please test this" pin on a (car, track, condition) combo — the
 * coverage map's action layer. Directs testing time at the gaps the engine
 * needs. Class is implied by the car. Cleared manually when the data lands.
 */
export interface TestRequest {
  id: number;
  car_id: number;
  track_id: number;
  condition: Condition;
  note?: string | null;
  created_by?: string | null;
  created_at: string;
}

/** Payload accepted by POST /api/test-requests. */
export interface NewTestRequestInput {
  car_id: number;
  track_id: number;
  condition: Condition;
  note?: string | null;
  created_by?: string | null;
}

// --- Race results (prediction accuracy) ---------------------------------------

/**
 * How the engine's pick actually went on race day — logged by a manager after
 * the race. Feeds the accuracy scoreboard on the briefing (visible to all
 * roles; input is manager/admin). `recommended_car_id` is a snapshot of the
 * board's #1 for the combo at logging time, so later recomputes can't rewrite
 * history.
 */
export const RESULT_VERDICTS = [
  { value: "nailed", label: "Nailed it", hint: "the pick delivered — right call" },
  { value: "solid", label: "Solid", hint: "competitive, no regrets" },
  { value: "missed", label: "Missed", hint: "wrong call — another car was the answer" },
] as const;

export type ResultVerdict = (typeof RESULT_VERDICTS)[number]["value"];

export interface RaceResult {
  id: number;
  track_id: number;
  class: RacingClass;
  raced_on: string; // YYYY-MM-DD
  recommended_car_id: number | null; // the board's pick when logged (null = no data at the time)
  raced_car_id: number; // what the team actually ran
  verdict: ResultVerdict;
  position?: string | null; // free text, e.g. "P3 in class"
  note?: string | null;
  created_by?: string | null;
  created_at: string;
}

/** Payload accepted by POST /api/race-results. */
export interface NewRaceResultInput {
  track_id: number;
  class: RacingClass;
  raced_on: string;
  recommended_car_id?: number | null;
  raced_car_id: number;
  verdict: ResultVerdict;
  position?: string | null;
  note?: string | null;
  created_by?: string | null;
}

/** A recommendation joined with car + track names for the dashboard. */
export interface RankingRow extends Recommendation {
  car_name: string;
  car_category: CarCategory;
  track_name: string;
}

// --- Driver leaderboard / analytics ------------------------------------------

/** One point on a driver's consistency-over-time trend line. */
export interface ConsistencyPoint {
  session_id: number;
  created_at: string;
  consistency: number;
}

/**
 * A driver's aggregate stats across every session they've logged (current era,
 * all cars/tracks/conditions combined — the factor scores are already
 * benchmark-normalised 0-100 so they're comparable across combos). SVS-weighted
 * the same way car aggregation is, so a thin/messy session counts less than a
 * clean full race.
 */
export interface DriverStat {
  driver_id: number;
  driver_name: string;
  sessions_used: number;
  total_laps: number;
  avg_pace: number;
  avg_consistency: number;
  avg_tyre: number;
  avg_mistakes: number;
  /** Std-dev across this driver's own 5 factor averages — lower = more balanced. */
  balance_spread: number;
  consistency_trend: ConsistencyPoint[];
}

export type BadgeId =
  | "fastest"
  | "consistent"
  | "tyre_whisperer"
  | "tyre_killer"
  | "lawn_mower"
  | "all_rounder"
  | "iron_man";

export interface BadgeHolder {
  tier: "gold" | "silver" | "bronze";
  driver_id: number;
  driver_name: string;
  /** The metric value that earned the tier, already in display units. */
  value: number;
}

export interface BadgeDef {
  id: BadgeId;
  label: string;
  emoji: string;
  hint: string;
  /** Roast badges get a different visual treatment (orange/red, not gold). */
  roast: boolean;
  holders: BadgeHolder[];
}
