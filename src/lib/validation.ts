// ============================================================================
// Input validation for the session-logging endpoint. Mirrors the DB CHECK
// constraints so bad data is rejected before it ever hits the store.
// ============================================================================

import { CONDITIONS, SESSION_TYPES, type SessionInput } from "@/types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: SessionInput;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function pctOk(v: unknown): boolean {
  return isFiniteNum(v) && v >= 0 && v <= 100;
}

/**
 * Validate + normalize a raw session payload. Times are expected in seconds
 * (the form converts "M:SS.mmm" → seconds before posting).
 */
export function validateSessionInput(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const b = (raw ?? {}) as Record<string, unknown>;

  const driver_name = typeof b.driver_name === "string" ? b.driver_name.trim() : "";
  if (!driver_name) errors.push("Driver name is required.");

  const car_id = Number(b.car_id);
  if (!Number.isInteger(car_id) || car_id <= 0) errors.push("A valid car must be selected.");

  const track_id = Number(b.track_id);
  if (!Number.isInteger(track_id) || track_id <= 0) errors.push("A valid track must be selected.");

  const session_type = b.session_type as SessionInput["session_type"];
  if (!SESSION_TYPES.includes(session_type)) errors.push("Session type is invalid.");

  const condition_reported = b.condition_reported as SessionInput["condition_reported"];
  if (!CONDITIONS.includes(condition_reported)) errors.push("Weather condition is invalid.");

  const lap_count = Number(b.lap_count);
  if (!Number.isInteger(lap_count) || lap_count <= 0) errors.push("Lap count must be a whole number greater than 0.");

  const best_lap_time = Number(b.best_lap_time);
  if (!isFiniteNum(best_lap_time) || best_lap_time <= 0) errors.push("Best lap time is required.");

  const avg_lap_time = Number(b.avg_lap_time);
  if (!isFiniteNum(avg_lap_time) || avg_lap_time <= 0) errors.push("Average lap time is required.");

  if (isFiniteNum(best_lap_time) && isFiniteNum(avg_lap_time) && avg_lap_time + 1e-6 < best_lap_time) {
    errors.push("Average lap time cannot be faster than the best lap time.");
  }

  const off_track_count = Number(b.off_track_count ?? 0);
  if (!Number.isInteger(off_track_count) || off_track_count < 0) errors.push("Off-track count must be 0 or a positive whole number.");

  const confidence_rating = Number(b.confidence_rating);
  if (!isFiniteNum(confidence_rating) || confidence_rating < 1 || confidence_rating > 10) {
    errors.push("Confidence rating must be between 1 and 10.");
  }

  // Optional per-lap times (seconds). Already numbers when sent by the form;
  // must all be positive and finite. Fewer than 2 laps carries no consistency
  // signal, so it's stored as "not provided".
  let lap_times: number[] | undefined;
  if (b.lap_times != null) {
    if (!Array.isArray(b.lap_times)) {
      errors.push("Lap times must be a list of numbers (seconds).");
    } else if (b.lap_times.length > 200) {
      errors.push("Lap times list is too long (max 200 laps).");
    } else if (!b.lap_times.every((t) => isFiniteNum(t) && t > 0)) {
      errors.push("Every lap time must be a positive number of seconds.");
    } else if (b.lap_times.length >= 2) {
      lap_times = b.lap_times.map((t) => Math.round((t as number) * 1000) / 1000);
    }
  }

  const tyres = {
    tyre_fl_pct_remaining: Number(b.tyre_fl_pct_remaining),
    tyre_fr_pct_remaining: Number(b.tyre_fr_pct_remaining),
    tyre_rl_pct_remaining: Number(b.tyre_rl_pct_remaining),
    tyre_rr_pct_remaining: Number(b.tyre_rr_pct_remaining),
  };
  for (const [key, val] of Object.entries(tyres)) {
    if (!pctOk(val)) errors.push(`Tyre value ${key.replace("tyre_", "").replace("_pct_remaining", "").toUpperCase()} must be 0–100.`);
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    data: {
      driver_name,
      car_id,
      track_id,
      session_type,
      condition_reported,
      patch_version: typeof b.patch_version === "string" ? b.patch_version.trim() || undefined : undefined,
      lap_count,
      best_lap_time,
      avg_lap_time,
      off_track_count,
      confidence_rating,
      setup_version: typeof b.setup_version === "string" ? b.setup_version.trim() || undefined : undefined,
      comments: typeof b.comments === "string" ? b.comments.trim() || undefined : undefined,
      lap_times,
      ...tyres,
    },
  };
}
