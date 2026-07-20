// ============================================================================
// Scoring engine — deterministic, explainable, pure functions.
// Implements SPEC.md §3 exactly. No DB access, no React: data in, scores out.
//
// Factor weights (Car Score):
//   Pace 35% · Consistency 25% · Tyre 15% · Drivability 15% · Mistakes 10%
//
// MVP NOTE on Consistency: SPEC §3.2 defines consistency from the std-dev of
// *every* lap, but the MVP session form logs only best + average + lap count
// (SPEC §5.1). We therefore use the best→average gap as the dispersion proxy.
// The dispersion is scored in ABSOLUTE SECONDS, not relative to lap time:
//   consistency = clamp(100 − (avg − best) / CONSISTENCY_TOLERANCE_S × 50)
// (Dividing by avg lap time — the old formula — crushed every car to ~99, since
// a 1 s gap over a ~140 s lap is <1%. A second of lap-to-lap scatter costs the
// same positions whatever the track length, so absolute seconds is the honest
// measure.) Swap in true std-dev via consistencyFactorFromLaps once the form
// captures full lap arrays — the call sites stay the same.
// ============================================================================

import type {
  Benchmark,
  Condition,
  FactorScores,
  FactorWeights,
  RacingClass,
  Session,
  SessionType,
  ValueComponents,
  WeightsConfig,
} from "@/types";
import { isSetupPatchStale } from "./patch";

// A session run on a setup built for an EARLIER patch than the one it was logged
// under is less representative of current-build performance — it still counts,
// but its Representativeness (and thus its weight in the car score) is discounted.
export const OLD_SETUP_REPRESENTATIVENESS_FACTOR = 0.7;

// --- weights ----------------------------------------------------------------

export const FACTOR_WEIGHTS = {
  pace: 0.35,
  consistency: 0.25,
  tyre: 0.15,
  drivability: 0.15,
  mistakes: 0.1,
} as const;

/**
 * Selectable Car-Score weightings. Each set sums to 1.0. The user picks one
 * (Manager/Admin only) and it applies globally — every driver sees the same
 * mathematically-derived ranking, tagged with the preset name for transparency.
 */
export const WEIGHT_PRESETS: { name: string; hint: string; weights: FactorWeights }[] = [
  {
    name: "Balanced",
    hint: "Default all-round — 35 / 25 / 15 / 15 / 10",
    weights: { pace: 0.35, consistency: 0.25, tyre: 0.15, drivability: 0.15, mistakes: 0.1 },
  },
  {
    name: "Pace-focused",
    hint: "Outright speed — qualifying & short races",
    weights: { pace: 0.5, consistency: 0.2, tyre: 0.1, drivability: 0.1, mistakes: 0.1 },
  },
  {
    name: "Tyre-saver",
    hint: "Endurance / long stints — reward low, even wear",
    weights: { pace: 0.25, consistency: 0.25, tyre: 0.3, drivability: 0.1, mistakes: 0.1 },
  },
  {
    name: "Sprint",
    hint: "Short races — mistakes costly, tyres barely matter",
    weights: { pace: 0.4, consistency: 0.2, tyre: 0.05, drivability: 0.15, mistakes: 0.2 },
  },
];

/** The out-of-the-box weighting used until a preset is chosen. */
export const DEFAULT_WEIGHTS_CONFIG: WeightsConfig = {
  preset: "Balanced",
  weights: { ...FACTOR_WEIGHTS },
};

/** Normalise arbitrary non-negative weights so they sum to 1 (keeps scores 0–100). */
export function normalizeWeights(w: FactorWeights): FactorWeights {
  const total = w.pace + w.consistency + w.tyre + w.drivability + w.mistakes;
  if (!(total > 0)) return { ...FACTOR_WEIGHTS };
  return {
    pace: w.pace / total,
    consistency: w.consistency / total,
    tyre: w.tyre / total,
    drivability: w.drivability / total,
    mistakes: w.mistakes / total,
  };
}

/**
 * Re-weight already-aggregated factor scores into a single 0–100 Car Score under
 * an arbitrary weighting. This is the client-side re-ranking primitive: because
 * a recommendation stores its five factor scores, the board can be re-ranked
 * under ANY preset in the browser (a per-driver "lens", the preset-winners strip)
 * without a server recompute. NOTE: it re-weights the EXISTING factors — it does
 * not re-pick the best setup (that's weight-dependent and server-side), so it's a
 * faithful re-rank of the current data, a close approximation for setup choice.
 */
export function weightedFactorScore(f: FactorScores, weights: FactorWeights): number {
  const w = normalizeWeights(weights);
  return round2(
    clamp(f.pace * w.pace + f.consistency * w.consistency + f.tyre * w.tyre + f.drivability * w.drivability + f.mistakes * w.mistakes),
  );
}

export const SVS_WEIGHTS = {
  completeness: 0.3,
  consistency: 0.25,
  cleanliness: 0.2,
  representativeness: 0.15,
  recency: 0.1,
} as const;

// --- small helpers ----------------------------------------------------------

export function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Population standard deviation. */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ============================================================================
// §3.1 Pace Factor (35%)
// ============================================================================

/**
 * Score the driver's best lap against the benchmark tiers for this
 * track/class/condition. Returns null when no benchmark is available so the
 * caller can decide how to handle it (we fall back to a neutral 50).
 */
export function paceFactor(bestLap: number, benchmark: Benchmark | null): number | null {
  if (!benchmark) return null;
  const { alien_time, competitive_time, good_time, midpack_time, tail_ender_time } = benchmark;

  if (bestLap < alien_time) return 100;
  if (bestLap < competitive_time) return 95;
  if (bestLap < good_time) return 85;
  if (bestLap < midpack_time) return 70;

  // Below midpack: linear decay from 50 toward 0 across midpack→tail-ender.
  const span = tail_ender_time - midpack_time;
  if (span <= 0) return 50;
  const score = 50 - ((bestLap - midpack_time) / span) * 30;
  return clamp(score, 0, 50);
}

// ============================================================================
// §3.2 Consistency Factor (25%)
// ============================================================================

/**
 * Score a lap-time dispersion (in SECONDS) to 0–100: 0 s = 100, and a gap of
 * `tolerance` seconds = 50. Absolute seconds, not relative to lap time.
 */
function dispersionScore(seconds: number, tolerance: number): number {
  if (!(tolerance > 0)) return 100;
  return clamp(100 - (Math.max(0, seconds) / tolerance) * 50);
}

/** consistency from the best→average gap (seconds). See CONSISTENCY_TOLERANCE_S. */
export function consistencyFactor(bestLap: number, avgLap: number): number {
  if (avgLap <= 0) return 0;
  return dispersionScore(avgLap - bestLap, CONSISTENCY_TOLERANCE_S);
}

/**
 * True-std-dev variant used when the session carries individual lap times.
 * Std-dev is a tighter measure than the best→avg gap, so it uses its own
 * (smaller) tolerance.
 */
export function consistencyFactorFromLaps(lapTimes: number[]): number {
  if (lapTimes.length < 2) return 100;
  return dispersionScore(stdDev(lapTimes), CONSISTENCY_STDDEV_TOLERANCE_S);
}

/**
 * Drop traffic/out/in-laps before measuring consistency: any lap more than
 * LAP_OUTLIER_FACTOR × the median is treated as not representative of pace.
 * (Slow side only — genuine flying laps are never that far over the median,
 * but out-laps and traffic easily are, and they'd swamp the std-dev.)
 */
export function cleanLaps(lapTimes: number[]): number[] {
  if (lapTimes.length < 3) return [...lapTimes];
  const sorted = [...lapTimes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return lapTimes.filter((t) => t <= median * LAP_OUTLIER_FACTOR);
}

/**
 * The consistency score for a session: true std-dev over its cleaned lap
 * array when one was logged (≥2 usable laps), otherwise the best→avg proxy.
 */
export function sessionConsistency(session: Session): number {
  if (session.lap_times && session.lap_times.length >= 2) {
    const usable = cleanLaps(session.lap_times.filter((t) => Number.isFinite(t) && t > 0));
    if (usable.length >= 2) return consistencyFactorFromLaps(usable);
  }
  return consistencyFactor(session.best_lap_time, session.avg_lap_time);
}

// ============================================================================
// §3.3 Tyre Factor (15%)
// ============================================================================

export function tyreFactor(remaining: [number, number, number, number]): number {
  const avgRemaining = remaining.reduce((a, b) => a + b, 0) / 4;
  const avgWearPct = 100 - avgRemaining;
  const uniformity = clamp(100 - stdDev(remaining));
  const score = (100 - avgWearPct) * 0.6 + uniformity * 0.4;
  return clamp(score);
}

// ============================================================================
// §3.4 Drivability Factor (15%)
// ============================================================================

export function drivabilityFactor(confidenceRating: number): number {
  return clamp(confidenceRating * 10);
}

// ============================================================================
// §3.5 Mistakes Factor (10%)
// ============================================================================

export function mistakesFactor(offTrackCount: number, lapCount: number): number {
  const laps = Math.max(1, lapCount);
  const expectedMax = (laps / 12.5) * 3; // ~3 OTs per 10–15 laps
  if (expectedMax <= 0) return offTrackCount === 0 ? 100 : 0;
  return clamp(100 - (offTrackCount / expectedMax) * 100);
}

// ============================================================================
// §3.6 Session Value Score (per-session weighting)
// ============================================================================

function completenessScore(lapCount: number): number {
  if (lapCount >= 15) return 100;
  if (lapCount >= 10) return 80 + ((lapCount - 10) / 5) * 20; // 10→80 .. 15→100
  return clamp((lapCount / 10) * 80); // 0→0 .. 10→80, decays below a stint
}

// This platform's data is gathered from dedicated TESTING (run in Practice
// sessions), not race telemetry — so Practice is the primary, authoritative
// source and must NOT be penalised. Race stays top (equally valid if ever
// logged); a pure Quali hotlap is slightly less representative of stint pace.
// The "thin hotlap vs substantial run" distinction is carried by `completeness`
// (lap count), not this tier. Legacy "Test" rows fall back to Practice's value.
const SESSION_TYPE_REPRESENTATIVENESS: Record<string, number> = {
  Race: 100,
  Practice: 100,
  Quali: 90,
};

const CONDITION_REPRESENTATIVENESS: Record<Condition, number> = {
  // Dry is most comparable to the (dry) benchmark sheet; wet/mixed less so.
  Dry: 1.0,
  Mixed: 0.95,
  Wet: 0.9,
};

function representativenessScore(type: SessionType, condition: Condition, oldSetup: boolean): number {
  const typeScore = SESSION_TYPE_REPRESENTATIVENESS[type] ?? 100; // unknown/legacy (e.g. "Test") → treat as Practice
  const base = clamp(typeScore * CONDITION_REPRESENTATIVENESS[condition]);
  return oldSetup ? clamp(base * OLD_SETUP_REPRESENTATIVENESS_FACTOR) : base;
}

function recencyScore(daysSince: number): number {
  if (daysSince <= 7) return 100;
  if (daysSince <= 30) return clamp(100 - ((daysSince - 7) / 23) * 60); // 7→100 .. 30→40
  return clamp(40 - (daysSince - 30) * 0.5, 10, 100); // slow decay to a floor of 10
}

export interface SvsResult {
  score: number;
  components: ValueComponents;
}

/**
 * Compute a session's value score (0-100) and its component breakdown.
 * `nowMs` is injected for determinism/testability.
 */
export function sessionValueScore(session: Session, nowMs: number): SvsResult {
  const created = Date.parse(session.created_at);
  const daysSince = Number.isFinite(created) ? Math.max(0, (nowMs - created) / 86_400_000) : 0;

  const components: ValueComponents = {
    completeness: round2(completenessScore(session.lap_count)),
    consistency: round2(sessionConsistency(session)),
    cleanliness: round2(mistakesFactor(session.off_track_count, session.lap_count)),
    representativeness: round2(
      // setup_version = the patch the setup was built on. Discounted only when it
      // predates the logged patch by a full patch tier or more — a hotfix-only
      // gap (e.g. 1.3.3 setup on a 1.3.3.4 session) is the same era, not stale.
      representativenessScore(
        session.session_type,
        session.condition_reported,
        isSetupPatchStale(session.setup_version, session.patch_version),
      ),
    ),
    recency: round2(recencyScore(daysSince)),
  };

  const score =
    components.completeness * SVS_WEIGHTS.completeness +
    components.consistency * SVS_WEIGHTS.consistency +
    components.cleanliness * SVS_WEIGHTS.cleanliness +
    components.representativeness * SVS_WEIGHTS.representativeness +
    components.recency * SVS_WEIGHTS.recency;

  return { score: round2(clamp(score)), components };
}

// ============================================================================
// Per-session factor scores
// ============================================================================

/** Neutral pace placeholder when no benchmark exists for the combo. */
export const NEUTRAL_PACE = 50;

export function scoreSession(session: Session, benchmark: Benchmark | null): FactorScores {
  const pace = paceFactor(session.best_lap_time, benchmark);
  return {
    pace: round2(pace ?? NEUTRAL_PACE),
    consistency: round2(sessionConsistency(session)),
    tyre: round2(
      tyreFactor([
        session.tyres.tyre_fl_pct_remaining,
        session.tyres.tyre_fr_pct_remaining,
        session.tyres.tyre_rl_pct_remaining,
        session.tyres.tyre_rr_pct_remaining,
      ]),
    ),
    drivability: round2(drivabilityFactor(session.confidence_rating)),
    mistakes: round2(mistakesFactor(session.off_track_count, session.lap_count)),
  };
}

// ============================================================================
// §3.7 Car Score (per-track aggregate, weighted by Session Value Score)
// ============================================================================

export interface CarScoreResult {
  car_score: number;
  factors: FactorScores;
  sessions_used: number;
  confidence_score: number;
}

interface ScoredSession {
  factors: FactorScores;
  svs: number;
}

/**
 * Aggregate up to the latest 10 sessions (caller pre-sorts/slices) into a Car
 * Score, weighting each session's factors by its Session Value Score. The final
 * factor→score weighting defaults to Balanced but accepts any active preset.
 */
export function aggregateCarScore(
  scored: ScoredSession[],
  weights: FactorWeights = FACTOR_WEIGHTS,
): CarScoreResult {
  const n = scored.length;
  if (n === 0) {
    return {
      car_score: 0,
      factors: { pace: 0, consistency: 0, tyre: 0, drivability: 0, mistakes: 0 },
      sessions_used: 0,
      confidence_score: 0,
    };
  }

  const totalSvs = scored.reduce((a, s) => a + s.svs, 0);
  // Fall back to an equal-weight average if every SVS is zero.
  const weightOf = (svs: number) => (totalSvs > 0 ? svs : 1);
  const weightSum = totalSvs > 0 ? totalSvs : n;

  const wAvg = (pick: (f: FactorScores) => number) =>
    scored.reduce((a, s) => a + pick(s.factors) * weightOf(s.svs), 0) / weightSum;

  const factors: FactorScores = {
    pace: round2(wAvg((f) => f.pace)),
    consistency: round2(wAvg((f) => f.consistency)),
    tyre: round2(wAvg((f) => f.tyre)),
    drivability: round2(wAvg((f) => f.drivability)),
    mistakes: round2(wAvg((f) => f.mistakes)),
  };

  const car_score = round2(
    clamp(
      factors.pace * weights.pace +
        factors.consistency * weights.consistency +
        factors.tyre * weights.tyre +
        factors.drivability * weights.drivability +
        factors.mistakes * weights.mistakes,
    ),
  );

  // Confidence: data volume × average session quality (avgSvs/100), 0–1.
  // Volume follows a smooth diminishing-returns curve n/(n+k): more sessions
  // always raise confidence (no hard cap), but with tapering reward — so a car
  // backed by many runs still reads as more trustworthy than one with a few,
  // while a strong 3-run sample already reads "solid" (~0.75 volume) rather than
  // being penalised against an arbitrary target. k = half-saturation point.
  const avgSvs = totalSvs / n;
  const volume = n / (n + CONFIDENCE_CURVE_K);
  const confidence_score = Math.round(clamp(volume * (avgSvs / 100), 0, 1) * 100) / 100;

  return { car_score, factors, sessions_used: n, confidence_score };
}

export const SCORING_WINDOW = 10; // latest N sessions per car-track combo aggregated
export const CONFIDENCE_CURVE_K = 1; // half-saturation of the confidence volume curve n/(n+k) — volume = 0.5 at n = k
export const CONSISTENCY_TOLERANCE_S = 2.0; // best→avg gap (s) that scores 50; 0 s = 100 (raise to be more lenient)
export const CONSISTENCY_STDDEV_TOLERANCE_S = 1.2; // per-lap std-dev (s) that scores 50 (lap-array path)
export const LAP_OUTLIER_FACTOR = 1.07; // laps >7% over the session median = traffic/out-laps, excluded from consistency
export const MIN_SESSIONS_PER_SETUP = 3; // runs a setup needs before it can be a car's "best" (else fall back to a blend)
export const MIN_SESSIONS_FOR_BADGE = 5; // sessions a driver needs before qualifying for a leaderboard badge (except Iron Man, which IS the volume metric)
