// ============================================================================
// Scoring engine — deterministic, explainable, pure functions.
// Implements SPEC.md §3 exactly. No DB access, no React: data in, scores out.
//
// Factor weights (Car Score):
//   Pace 35% · Consistency 25% · Tyre 15% · Drivability 15% · Mistakes 10%
//
// MVP NOTE on Consistency: SPEC §3.2 defines consistency from the std-dev of
// *every* lap, but the MVP session form logs only best + average + lap count
// (SPEC §5.1). We therefore use the best→average gap as the dispersion proxy:
//   consistency = 100 × (1 − (avg − best) / avg)
// A tight best→avg gap means consistent laps. Swap in true std-dev once the
// form captures full lap arrays — the call sites stay the same.
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

/** consistency = 100 × (1 − dispersion / avg). Dispersion = avg − best (MVP proxy). */
export function consistencyFactor(bestLap: number, avgLap: number): number {
  if (avgLap <= 0) return 0;
  const dispersion = Math.max(0, avgLap - bestLap);
  return clamp(100 * (1 - dispersion / avgLap));
}

/** True-std-dev variant for when full lap arrays are available (future). */
export function consistencyFactorFromLaps(lapTimes: number[]): number {
  if (lapTimes.length < 2) return 100;
  const avg = lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length;
  if (avg <= 0) return 0;
  return clamp(100 * (1 - stdDev(lapTimes) / avg));
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

const SESSION_TYPE_REPRESENTATIVENESS: Record<SessionType, number> = {
  Race: 100,
  Quali: 85,
  Test: 70,
  Practice: 60,
};

const CONDITION_REPRESENTATIVENESS: Record<Condition, number> = {
  // Dry is most comparable to the (dry) benchmark sheet; wet/mixed less so.
  Dry: 1.0,
  Mixed: 0.95,
  Wet: 0.9,
};

function representativenessScore(type: SessionType, condition: Condition): number {
  return clamp(SESSION_TYPE_REPRESENTATIVENESS[type] * CONDITION_REPRESENTATIVENESS[condition]);
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
    consistency: round2(consistencyFactor(session.best_lap_time, session.avg_lap_time)),
    cleanliness: round2(mistakesFactor(session.off_track_count, session.lap_count)),
    representativeness: round2(
      representativenessScore(session.session_type, session.condition_reported),
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
    consistency: round2(consistencyFactor(session.best_lap_time, session.avg_lap_time)),
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
  // Volume saturates at CONFIDENCE_TARGET_SESSIONS (not the full 10-session
  // window) so a handful of good runs reads as genuinely confident.
  const avgSvs = totalSvs / n;
  const volume = Math.min(1, n / CONFIDENCE_TARGET_SESSIONS);
  const confidence_score = Math.round(clamp(volume * (avgSvs / 100), 0, 1) * 100) / 100;

  return { car_score, factors, sessions_used: n, confidence_score };
}

export const SCORING_WINDOW = 10; // latest N sessions per car-track combo aggregated
export const CONFIDENCE_TARGET_SESSIONS = 5; // sessions for "full" data-volume confidence
