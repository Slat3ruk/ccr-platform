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
  MIN_SESSIONS_PER_SETUP,
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
 * Pure-ish scoring core. Buckets sessions by (car, track, condition), then
 * within each bucket scores the car by its BEST qualifying setup:
 *   - sub-group by setup_version (trimmed; blank = one "unspecified" bucket);
 *   - a setup qualifies once it has >= MIN_SESSIONS_PER_SETUP runs;
 *   - among qualifying setups, aggregate each one's latest SCORING_WINDOW runs
 *     and pick the highest Car Score (best race package, not a hot lap — the
 *     score is already race-weighted);
 *   - if NONE qualify (thin data, or all runs on one unspecified setup with
 *     < MIN runs), fall back to blending the bucket's latest SCORING_WINDOW —
 *     i.e. today's behaviour, so untagged setups collapse to the old model.
 * The winning setup_version is recorded on the recommendation (null when blended
 * or unspecified). No store writes — callers decide whether to persist (live
 * recompute) or just serve the result (archived-era view).
 */
export function scoreGroups(
  sessions: Session[],
  cars: Car[],
  benchmarks: Benchmark[],
  config: WeightsConfig,
  nowMs: number,
): GroupScores {
  const carById = new Map(cars.map((c) => [c.id, c]));

  // Session Value Score is per-session quality (setup-independent), so compute
  // it once for every in-range session — every one gets a fresh SVS on recompute.
  const sessionValues = new Map<number, SvsResult>();
  for (const s of sessions) sessionValues.set(s.id, sessionValueScore(s, nowMs));

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

  for (const [, groupSessions] of groups) {
    const sample = groupSessions[0];
    const car = carById.get(sample.car_id);
    if (!car) continue;
    const cls: RacingClass = categoryToClass(car.category);
    const condition = sample.condition_reported;

    // Benchmark for this combo; fall back to the Dry sheet if the condition
    // has no dedicated benchmark (we only seed Dry initially).
    const benchmark =
      benchmarks.find((b) => b.track_id === sample.track_id && b.class === cls && b.condition === condition) ??
      benchmarks.find((b) => b.track_id === sample.track_id && b.class === cls && b.condition === "Dry") ??
      null;

    // Aggregate a setup's (or the whole bucket's) latest SCORING_WINDOW runs.
    const aggregateWindow = (list: Session[]) => {
      const window = [...list]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
        .slice(0, SCORING_WINDOW);
      const scored = window.map((s) => ({
        factors: scoreSession(s, benchmark),
        svs: sessionValues.get(s.id)?.score ?? 0,
      }));
      return { window, agg: aggregateCarScore(scored, config.weights) };
    };

    // Sub-group by setup (trimmed; "" = unspecified). Prefer the controlled
    // `setup_type` (so all versions of e.g. "Race · Esport" group together);
    // fall back to legacy free-text `setup_version` for pre-dropdown sessions.
    const bySetup = new Map<string, Session[]>();
    for (const s of groupSessions) {
      const key = (s.setup_type ?? s.setup_version ?? "").trim();
      const arr = bySetup.get(key);
      if (arr) arr.push(s);
      else bySetup.set(key, [s]);
    }

    // Best qualifying setup wins; ties → higher score, then first seen.
    let chosen: { window: Session[]; agg: ReturnType<typeof aggregateCarScore> } | null = null;
    let bestSetup: string | null = null;
    for (const [setup, list] of bySetup) {
      if (list.length < MIN_SESSIONS_PER_SETUP) continue;
      const res = aggregateWindow(list);
      if (!chosen || res.agg.car_score > chosen.agg.car_score) {
        chosen = res;
        bestSetup = setup || null; // unspecified bucket → null
      }
    }

    // No setup cleared the bar → blend the whole bucket (today's behaviour).
    if (!chosen) {
      chosen = aggregateWindow(groupSessions);
      bestSetup = null;
    }

    const { window, agg } = chosen;
    recommendations.push({
      car_id: sample.car_id,
      track_id: sample.track_id,
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
      best_setup: bestSetup,
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
