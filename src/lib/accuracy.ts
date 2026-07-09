// ============================================================================
// Prediction accuracy — how often the engine's race-day pick was the right
// call. Pure math over logged RaceResults, rendered at the bottom of the
// briefing (all roles; the input form is manager/admin). The scoreboard is
// deliberately honest: "hit rate" counts nailed + solid — a competitive car
// was still a good call — and the follow rate says how often the team actually
// ran the pick (accuracy only measures the races where the engine's advice
// was in play).
// ============================================================================

import type { RaceResult } from "@/types";

export interface AccuracySummary {
  n: number;
  nailed: number;
  solid: number;
  missed: number;
  /** % of results where the pick was nailed or solid (0–100, rounded). Null when n = 0. */
  hitPct: number | null;
  /** Of the results with a recorded recommendation, how many ran that exact car. */
  followed: number;
  /** Results that had a recommendation snapshot at all. */
  withPick: number;
}

export function summarizeAccuracy(results: RaceResult[]): AccuracySummary {
  const n = results.length;
  const nailed = results.filter((r) => r.verdict === "nailed").length;
  const solid = results.filter((r) => r.verdict === "solid").length;
  const missed = results.filter((r) => r.verdict === "missed").length;
  const withPickRows = results.filter((r) => r.recommended_car_id != null);
  const followed = withPickRows.filter((r) => r.raced_car_id === r.recommended_car_id).length;
  return {
    n,
    nailed,
    solid,
    missed,
    hitPct: n === 0 ? null : Math.round(((nailed + solid) / n) * 100),
    followed,
    withPick: withPickRows.length,
  };
}
