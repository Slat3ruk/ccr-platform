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

export type SessionType = "Practice" | "Quali" | "Race" | "Test";
export type Condition = "Dry" | "Wet" | "Mixed";
export type DriverRole = "driver" | "engineer" | "admin";

export const CAR_CATEGORIES: CarCategory[] = ["Hypercar", "GT3", "LMP2", "LMP3"];
export const RACING_CLASSES: RacingClass[] = ["LMGT3", "LMH", "LMP3", "LMP2-ELMS", "LMP2-WEC"];
export const SESSION_TYPES: SessionType[] = ["Practice", "Quali", "Race", "Test"];
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
  created_at: string;
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
  good_time: number;
  midpack_time: number;
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
  created_by?: string | null;
}

/** A race event joined with its track name for the briefing/calendar UI. */
export interface RaceRow extends RaceEvent {
  track_name: string;
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
