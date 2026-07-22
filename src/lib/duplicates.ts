// ============================================================================
// Accidental double-submit detection.
//
// The realistic cause is a double-click or an impatient second press firing two
// identical POSTs — which a client-side check can't catch, because both requests
// leave before any state updates. So this runs on the server, at write time.
//
// Precision matters more than recall here: a false positive nags someone who
// legitimately ran two similar stints, so the test is deliberately strict —
// the SAME driver, car, track and condition, with byte-identical lap count and
// both lap times, inside a few hours. Two genuinely separate runs essentially
// never match to the millisecond on both best AND average.
// ============================================================================

import type { Session } from "@/types";

/** Two identical runs hours apart are implausible; a stray re-submit isn't. */
export const DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface DuplicateCandidate {
  driver_id: number;
  car_id: number;
  track_id: number;
  condition_reported: string;
  lap_count: number;
  best_lap_time: number;
  avg_lap_time: number;
}

/** Lap times are stored to ms; compare on that grid rather than exact floats. */
function sameTime(a: number, b: number): boolean {
  return Math.round(a * 1000) === Math.round(b * 1000);
}

/**
 * The existing session this one appears to duplicate, or null.
 * `now` is injectable so the window is testable without faking the clock.
 */
export function findDuplicate(
  existing: Session[],
  candidate: DuplicateCandidate,
  now: number = Date.now(),
): Session | null {
  for (const s of existing) {
    if (s.driver_id !== candidate.driver_id) continue;
    if (s.car_id !== candidate.car_id) continue;
    if (s.track_id !== candidate.track_id) continue;
    if (s.condition_reported !== candidate.condition_reported) continue;
    if (s.lap_count !== candidate.lap_count) continue;
    if (!sameTime(s.best_lap_time, candidate.best_lap_time)) continue;
    if (!sameTime(s.avg_lap_time, candidate.avg_lap_time)) continue;

    const age = now - Date.parse(s.created_at);
    if (!Number.isFinite(age) || age < 0 || age > DUPLICATE_WINDOW_MS) continue;
    return s;
  }
  return null;
}

/** Minutes since a session was logged, for the warning message. */
export function minutesAgo(session: Session, now: number = Date.now()): number {
  return Math.max(0, Math.round((now - Date.parse(session.created_at)) / 60000));
}
