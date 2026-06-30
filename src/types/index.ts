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
  setup_version?: string | null;
  svm_data?: unknown;
  comments?: string | null;
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
  setup_version?: string;
  comments?: string;
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

/** A recommendation joined with car + track names for the dashboard. */
export interface RankingRow extends Recommendation {
  car_name: string;
  car_category: CarCategory;
  track_name: string;
}
