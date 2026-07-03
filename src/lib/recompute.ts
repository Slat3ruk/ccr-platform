// ============================================================================
// Recommendation recompute. Full rebuild: groups sessions by
// (car, track, condition), scores the latest N of each group, and writes one
// recommendation row per group. Cheap at MVP data volumes and always correct
// (no stale rows after deletes). Triggered after session create/update/delete
// and by POST /api/rankings/recompute.
//
// ERA SCOPING: live rankings only score the CURRENT era (see lib/eras.ts) —
// sessions from before the newest "line in the sand" are preserved but no
// longer influence the board. Archived eras are viewable via the rankings
// API's era_id param, which reuses scoreGroups() ad-hoc without persisting.
// ============================================================================

import {
  categoryToClass,
  type Benchmark,
  type Car,
  type Condition,
  type RacingClass,
  type Session,
  type WeightsConfig,
} from "@/types";
import { currentEraRange, inRange, type EraRange } from "./eras";
import { getStore } from "./db";
import type { NewRecommendation, Store } from "./db/types";
import {
  aggregateCarScore,
  DEFAULT_WEIGHTS_CONFIG,
  scoreSession,
  sessionValueScore,
  SCORING_WINDOW,
  type SvsResult,
} from "./scoring";

export interface RecomputeSummary {
  recommendations: number;
  sessions_scored: number;
  groups: number;
  weights_preset: string;
  era: string;
}

function groupKey(carId: number, trackId: number, condition: Condition): string {
  return `${carId}|${trackId}|${condition}`;
}

export interface GroupScores {
  recommendations: NewRecommendation[];
  /** Per-session SVS results for every session that was scored. */
  sessionValues: Map<number, SvsResult>;
}

/**
 * Pure-ish scoring core: bucket sessions by (car, track, condition), score the
 * latest SCORING_WINDOW of each bucket under `config`, and return the would-be
 * recommendation rows. No store writes — callers decide whether to persist
 * (live recompute) or just serve the result (archived-era view).
 */
export function scoreGroups(
  sessions: Session[],
  cars: Car[],
  benchmarks: Benchmark[],
  config: WeightsConfig,
  nowMs: number,
): GroupScores {
  const carById = new Map(cars.map((c) => [c.id, c]));

  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = groupKey(s.car_id, s.track_id, s.condition_reported);
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(s);
  }

  const recommendations: NewRecommendation[] = [];
  const sessionValues = new Map<number, SvsResult>();

  for (const [, groupSessions] of groups) {
    // Latest N by created_at (listSessions already returns desc, but be safe).
    const ordered = [...groupSessions].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id,
    );
    const window = ordered.slice(0, SCORING_WINDOW);
    if (window.length === 0) continue;

    const first = window[0];
    const car = carById.get(first.car_id);
    if (!car) continue;
    const cls: RacingClass = categoryToClass(car.category);
    const condition = first.condition_reported;

    // Benchmark for this combo; fall back to the Dry sheet if the condition
    // has no dedicated benchmark (we only seed Dry initially).
    const benchmark =
      benchmarks.find((b) => b.track_id === first.track_id && b.class === cls && b.condition === condition) ??
      benchmarks.find((b) => b.track_id === first.track_id && b.class === cls && b.condition === "Dry") ??
      null;

    const scored = [];
    for (const s of window) {
      const svsResult = sessionValueScore(s, nowMs);
      sessionValues.set(s.id, svsResult);
      scored.push({ factors: scoreSession(s, benchmark), svs: svsResult.score });
    }

    const agg = aggregateCarScore(scored, config.weights);

    recommendations.push({
      car_id: first.car_id,
      track_id: first.track_id,
      class: cls,
      condition,
      car_score: agg.car_score,
      pace_factor: agg.factors.pace,
      consistency_factor: agg.factors.consistency,
      tyre_factor: agg.factors.tyre,
      drivability_factor: agg.factors.drivability,
      mistakes_factor: agg.factors.mistakes,
      sessions_used: agg.sessions_used,
      session_ids: window.map((s) => s.id),
      confidence_score: agg.confidence_score,
      weights_preset: config.preset,
    });
  }

  return { recommendations, sessionValues };
}

/** Filter sessions to a time range (era scoping). */
export function sessionsInRange(sessions: Session[], range: EraRange): Session[] {
  return sessions.filter((s) => inRange(Date.parse(s.created_at), range));
}

export async function recomputeAll(
  store: Store = getStore(),
  nowMs = Date.now(),
  weightsConfig?: WeightsConfig,
): Promise<RecomputeSummary> {
  await store.init();

  // The active weighting is global: use the one passed in (from the weights
  // endpoint) or the one persisted in settings, falling back to Balanced. Every
  // recompute path (session create/delete, seed, sync) picks it up automatically.
  const config = weightsConfig ?? (await store.getSetting<WeightsConfig>("weights")) ?? DEFAULT_WEIGHTS_CONFIG;

  const [allSessions, cars, benchmarks, eras] = await Promise.all([
    store.listSessions(),
    store.listCars(),
    store.listBenchmarks(),
    store.listEras(),
  ]);

  // Live board = current era only. With no eras defined this is all data.
  const range = currentEraRange(eras, nowMs);
  const sessions = sessionsInRange(allSessions, range);
  const eraName = eras.length
    ? (eras.filter((e) => Date.parse(e.starts_at) <= nowMs).pop()?.name ?? "pre-era")
    : "all data";

  const { recommendations, sessionValues } = scoreGroups(sessions, cars, benchmarks, config, nowMs);

  await store.clearRecommendations();
  for (const rec of recommendations) {
    await store.upsertRecommendation(rec);
  }
  for (const [sessionId, { score, components }] of sessionValues) {
    await store.setSessionValue(sessionId, score, components);
  }

  return {
    recommendations: recommendations.length,
    sessions_scored: sessionValues.size,
    groups: recommendations.length,
    weights_preset: config.preset,
    era: eraName,
  };
}
