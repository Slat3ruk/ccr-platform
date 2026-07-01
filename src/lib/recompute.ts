// ============================================================================
// Recommendation recompute. Full rebuild: groups every session by
// (car, track, condition), scores the latest 10 of each group, and writes one
// recommendation row per group. Cheap at MVP data volumes and always correct
// (no stale rows after deletes). Triggered after session create/update/delete
// and by POST /api/rankings/recompute.
// ============================================================================

import { categoryToClass, type Condition, type RacingClass, type Session, type WeightsConfig } from "@/types";
import { getStore } from "./db";
import type { Store } from "./db/types";
import {
  aggregateCarScore,
  DEFAULT_WEIGHTS_CONFIG,
  scoreSession,
  sessionValueScore,
  SCORING_WINDOW,
} from "./scoring";

export interface RecomputeSummary {
  recommendations: number;
  sessions_scored: number;
  groups: number;
  weights_preset: string;
}

function groupKey(carId: number, trackId: number, condition: Condition): string {
  return `${carId}|${trackId}|${condition}`;
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

  const [sessions, cars, benchmarks] = await Promise.all([
    store.listSessions(),
    store.listCars(),
    store.listBenchmarks(),
  ]);

  const carById = new Map(cars.map((c) => [c.id, c]));

  // Bucket sessions by car/track/condition.
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

  await store.clearRecommendations();

  let recommendations = 0;
  let sessionsScored = 0;

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
      const { score: svs, components } = sessionValueScore(s, nowMs);
      await store.setSessionValue(s.id, svs, components);
      scored.push({ factors: scoreSession(s, benchmark), svs });
      sessionsScored++;
    }

    const agg = aggregateCarScore(scored, config.weights);

    await store.upsertRecommendation({
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
    recommendations++;
  }

  return { recommendations, sessions_scored: sessionsScored, groups: groups.size, weights_preset: config.preset };
}
