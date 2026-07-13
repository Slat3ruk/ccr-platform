// ============================================================================
// Unit tests for the pure scoring engine. These lock in the deterministic
// behaviour of the 5-factor model, the Session Value Score, the confidence
// curve, and the adjustable weights — the maths the whole product rests on.
// Run: npm test
// ============================================================================

import { describe, expect, it } from "vitest";
import type { Benchmark, Session } from "@/types";
import {
  aggregateCarScore,
  clamp,
  cleanLaps,
  consistencyFactor,
  consistencyFactorFromLaps,
  CONSISTENCY_TOLERANCE_S,
  DEFAULT_WEIGHTS_CONFIG,
  drivabilityFactor,
  FACTOR_WEIGHTS,
  LAP_OUTLIER_FACTOR,
  mistakesFactor,
  normalizeWeights,
  paceFactor,
  scoreSession,
  sessionConsistency,
  sessionValueScore,
  stdDev,
  tyreFactor,
  weightedFactorScore,
  WEIGHT_PRESETS,
} from "./scoring";

// --- factories ---------------------------------------------------------------

function makeBenchmark(over: Partial<Benchmark> = {}): Benchmark {
  return {
    id: 1,
    track_id: 1,
    class: "LMGT3",
    condition: "Dry",
    alien_time: 100,
    competitive_time: 105,
    good_time: 110,
    good_102_time: 108,
    midpack_time: 120,
    midpack_104_time: 115,
    tail_ender_time: 130,
    offline_time: 140,
    data_readiness_pct: 100,
    patch_version: "1.3 +",
    last_synced_at: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

function makeSession(over: Partial<Session> = {}): Session {
  const created = "2026-07-01T00:00:00.000Z";
  return {
    id: 1,
    driver_id: 1,
    car_id: 1,
    track_id: 1,
    session_type: "Race",
    condition_reported: "Dry",
    patch_version: null,
    lap_count: 12,
    best_lap_time: 100,
    avg_lap_time: 101,
    off_track_count: 0,
    off_track_penalty_points: 0,
    confidence_rating: 8,
    setup_version: null,
    svm_data: null,
    comments: null,
    session_value_score: null,
    value_components: null,
    created_at: created,
    updated_at: created,
    tyres: {
      tyre_fl_pct_remaining: 90,
      tyre_fr_pct_remaining: 90,
      tyre_rl_pct_remaining: 88,
      tyre_rr_pct_remaining: 88,
      avg_wear_pct: 11,
    },
    ...over,
  };
}

// --- helpers -----------------------------------------------------------------

describe("clamp / stdDev", () => {
  it("clamps to [0,100] by default", () => {
    expect(clamp(-5)).toBe(0);
    expect(clamp(150)).toBe(100);
    expect(clamp(42)).toBe(42);
    expect(clamp(NaN)).toBe(0);
  });

  it("computes population standard deviation", () => {
    expect(stdDev([2, 2, 2])).toBe(0);
    expect(stdDev([1, 3])).toBe(1); // mean 2, var 1
    expect(stdDev([])).toBe(0);
  });
});

// --- §3.1 pace ---------------------------------------------------------------

describe("paceFactor", () => {
  const b = makeBenchmark();
  it("maps a lap to the right tier", () => {
    expect(paceFactor(99, b)).toBe(100); // < alien
    expect(paceFactor(103, b)).toBe(95); // < competitive
    expect(paceFactor(108, b)).toBe(85); // < good
    expect(paceFactor(115, b)).toBe(70); // < midpack
  });
  it("decays linearly below midpack", () => {
    // 125 is halfway from midpack(120) to tail-ender(130) → 50 − 0.5*30 = 35
    expect(paceFactor(125, b)).toBe(35);
    expect(paceFactor(200, b)).toBe(0); // far off the back, clamped
  });
  it("returns null with no benchmark", () => {
    expect(paceFactor(100, null)).toBeNull();
  });
});

// --- §3.2 consistency (the regression that motivated the absolute-seconds fix)

describe("consistencyFactor", () => {
  it("scores absolute seconds, not relative to lap time", () => {
    expect(consistencyFactor(100, 100)).toBe(100); // no gap
    expect(consistencyFactor(100, 100 + CONSISTENCY_TOLERANCE_S)).toBe(50); // gap = tolerance
    expect(consistencyFactor(100, 101)).toBe(75); // 1s gap
  });

  it("gives the SAME score for the same absolute gap regardless of lap length", () => {
    // The old (÷ avg) formula crushed a 1s gap to ~99 at long laps. Now a 1s gap
    // is 75 whether the lap is 90s or 140s.
    expect(consistencyFactor(90, 91)).toBe(75);
    expect(consistencyFactor(140, 141)).toBe(75);
    expect(consistencyFactor(300, 301)).toBe(75);
  });

  it("actually differentiates the real demo gaps (0.7s vs 1.5s)", () => {
    const tight = consistencyFactor(138.3, 139.0); // 0.7s → 82.5
    const loose = consistencyFactor(141.2, 142.7); // 1.5s → 62.5
    expect(tight).toBeCloseTo(82.5, 5);
    expect(loose).toBeCloseTo(62.5, 5);
    expect(tight - loose).toBeGreaterThan(15); // meaningful spread, not ~1 point
  });

  it("never returns negative or > 100", () => {
    expect(consistencyFactor(100, 110)).toBe(0); // huge gap, clamped
    expect(consistencyFactor(100, 99)).toBe(100); // avg faster than best (shouldn't happen) → clamps
    expect(consistencyFactor(100, 0)).toBe(0); // guard: non-positive avg
  });

  it("std-dev variant differentiates too", () => {
    expect(consistencyFactorFromLaps([100, 100, 100])).toBe(100); // zero spread
    expect(consistencyFactorFromLaps([100])).toBe(100); // single lap → neutral
    expect(consistencyFactorFromLaps([99, 101])).toBeLessThan(100); // some spread
  });
});

// --- per-lap consistency path --------------------------------------------------

describe("cleanLaps", () => {
  it("drops traffic/out-laps more than the outlier factor over the median", () => {
    const median = 100;
    const outLap = median * LAP_OUTLIER_FACTOR + 1; // clearly over
    expect(cleanLaps([100, 100.2, 99.8, outLap])).toEqual([100, 100.2, 99.8]);
  });

  it("keeps genuine flying laps (fast side is never trimmed)", () => {
    expect(cleanLaps([100, 99, 98.5, 100.5])).toHaveLength(4);
  });

  it("leaves tiny arrays alone (no median to trust)", () => {
    expect(cleanLaps([100, 130])).toEqual([100, 130]);
  });
});

describe("sessionConsistency", () => {
  it("uses true std-dev when lap times are present", () => {
    // Tight laps (σ ≈ 0.08 s) but a big best→avg gap would score much lower via proxy.
    const s = makeSession({
      best_lap_time: 100,
      avg_lap_time: 101.5,
      lap_times: [100, 100.1, 100.2, 100.1, 100.0],
    });
    const withLaps = sessionConsistency(s);
    const proxyOnly = consistencyFactor(100, 101.5);
    expect(withLaps).toBeGreaterThan(90); // tiny real deviation
    expect(withLaps).toBeGreaterThan(proxyOnly); // proxy would have punished them
  });

  it("falls back to best→avg when no laps logged", () => {
    const s = makeSession({ best_lap_time: 100, avg_lap_time: 101, lap_times: null });
    expect(sessionConsistency(s)).toBe(consistencyFactor(100, 101));
  });

  it("ignores out-laps when judging consistency", () => {
    const clean = sessionConsistency(makeSession({ lap_times: [100, 100.2, 100.1, 100.3] }));
    const withOutLap = sessionConsistency(makeSession({ lap_times: [100, 100.2, 100.1, 100.3, 125] }));
    expect(withOutLap).toBeCloseTo(clean, 0); // the 125 s out-lap barely moves it
  });

  it("scoreSession picks up the lap-array path", () => {
    const s = makeSession({ lap_times: [100, 100.1, 100.05, 100.2] });
    expect(scoreSession(s, null).consistency).toBeGreaterThan(90);
  });
});

// --- §3.3–3.5 tyre / drivability / mistakes ----------------------------------

describe("tyreFactor", () => {
  it("rewards low, even wear", () => {
    expect(tyreFactor([100, 100, 100, 100])).toBe(100); // fresh
    expect(tyreFactor([50, 50, 50, 50])).toBe(70); // 50% worn, even
    expect(tyreFactor([100, 100, 0, 0])).toBe(50); // very uneven
  });
});

describe("drivabilityFactor", () => {
  it("scales the 1–10 confidence slider to 0–100", () => {
    expect(drivabilityFactor(10)).toBe(100);
    expect(drivabilityFactor(5)).toBe(50);
    expect(drivabilityFactor(1)).toBe(10);
  });
});

describe("mistakesFactor", () => {
  it("is 100 with no off-tracks and drops monotonically", () => {
    expect(mistakesFactor(0, 12)).toBe(100);
    expect(mistakesFactor(1, 12)).toBeLessThan(100);
    expect(mistakesFactor(2, 12)).toBeLessThan(mistakesFactor(1, 12));
  });
});

// --- §3.6 Session Value Score ------------------------------------------------

describe("sessionValueScore", () => {
  it("returns components and a 0–100 score; a fresh run is fully recent", () => {
    const s = makeSession();
    const nowMs = Date.parse(s.created_at); // same instant → 0 days old
    const { score, components } = sessionValueScore(s, nowMs);
    expect(components.recency).toBe(100);
    expect(components.consistency).toBe(75); // best 100, avg 101 → 1s gap → 75
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("penalises old, off-track, unrepresentative sessions", () => {
    const fresh = makeSession();
    const stale = makeSession({
      session_type: "Practice",
      off_track_count: 5,
      lap_count: 4,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const nowMs = Date.parse("2026-07-01T00:00:00.000Z");
    expect(sessionValueScore(stale, nowMs).score).toBeLessThan(sessionValueScore(fresh, nowMs).score);
  });

  it("does not penalise Practice (the platform's primary data source) vs Race on representativeness", () => {
    const nowMs = Date.parse("2026-07-01T00:00:00.000Z");
    const race = makeSession({ session_type: "Race", created_at: "2026-07-01T00:00:00.000Z" });
    const practice = makeSession({ session_type: "Practice", created_at: "2026-07-01T00:00:00.000Z" });
    expect(sessionValueScore(practice, nowMs).components.representativeness).toBe(100);
    expect(sessionValueScore(practice, nowMs).components.representativeness).toBe(
      sessionValueScore(race, nowMs).components.representativeness,
    );
  });

  it("discounts representativeness when the setup predates the session's patch", () => {
    const nowMs = Date.parse("2026-07-01T00:00:00.000Z");
    const current = makeSession({ patch_version: "1.3.4", setup_version: "1.3.4", created_at: "2026-07-01T00:00:00.000Z" });
    const stale = makeSession({ patch_version: "1.3.4", setup_version: "1.2.9", created_at: "2026-07-01T00:00:00.000Z" });
    const r0 = sessionValueScore(current, nowMs).components.representativeness;
    const r1 = sessionValueScore(stale, nowMs).components.representativeness;
    expect(r1).toBeCloseTo(r0 * 0.7, 5); // OLD_SETUP_REPRESENTATIVENESS_FACTOR
    expect(sessionValueScore(stale, nowMs).score).toBeLessThan(sessionValueScore(current, nowMs).score);
  });

  it("treats a legacy 'Test' session type as Practice (no NaN, full representativeness)", () => {
    const nowMs = Date.parse("2026-07-01T00:00:00.000Z");
    // Cast: "Test" is no longer a valid SessionType, but old rows may still carry it.
    const legacy = makeSession({ session_type: "Test" as never, created_at: "2026-07-01T00:00:00.000Z" });
    const svs = sessionValueScore(legacy, nowMs);
    expect(Number.isFinite(svs.score)).toBe(true);
    expect(svs.components.representativeness).toBe(100);
  });
});

// --- §3.7 aggregate + confidence + weights -----------------------------------

describe("aggregateCarScore", () => {
  const factors = { pace: 80, consistency: 60, tyre: 40, drivability: 100, mistakes: 20 };

  it("returns zeros for no sessions", () => {
    const r = aggregateCarScore([]);
    expect(r.car_score).toBe(0);
    expect(r.sessions_used).toBe(0);
    expect(r.confidence_score).toBe(0);
  });

  it("applies the default (Balanced) weights", () => {
    // 80*.35 + 60*.25 + 40*.15 + 100*.15 + 20*.10 = 66
    const r = aggregateCarScore([{ factors, svs: 100 }]);
    expect(r.car_score).toBe(66);
  });

  it("honours a different weighting", () => {
    const pace = WEIGHT_PRESETS.find((p) => p.name === "Pace-focused")!.weights;
    // 80*.5 + 60*.2 + 40*.1 + 100*.1 + 20*.1 = 68
    expect(aggregateCarScore([{ factors, svs: 100 }], pace).car_score).toBe(68);
  });

  it("weights each session's factors by its SVS", () => {
    const r = aggregateCarScore([
      { factors: { ...factors, pace: 100 }, svs: 75 },
      { factors: { ...factors, pace: 0 }, svs: 25 },
    ]);
    // (100*75 + 0*25) / (75+25) = 75
    expect(r.factors.pace).toBe(75);
  });

  it("confidence follows the n/(n+1) volume curve × quality", () => {
    const one = aggregateCarScore([{ factors, svs: 100 }]);
    const three = aggregateCarScore([
      { factors, svs: 100 },
      { factors, svs: 100 },
      { factors, svs: 100 },
    ]);
    expect(one.confidence_score).toBe(0.5); // 1/2 * 1.0
    expect(three.confidence_score).toBe(0.75); // 3/4 * 1.0
    expect(three.confidence_score).toBeGreaterThan(one.confidence_score); // more data = more trust
  });
});

describe("scoreSession", () => {
  it("falls back to a neutral pace when no benchmark exists", () => {
    expect(scoreSession(makeSession(), null).pace).toBe(50);
  });
});

describe("weightedFactorScore (client-side lens re-ranking)", () => {
  const factors = { pace: 80, consistency: 60, tyre: 40, drivability: 100, mistakes: 20 };

  it("matches aggregateCarScore's Balanced maths for the same factors", () => {
    // Same 66 as aggregateCarScore's Balanced test — the lens re-rank is consistent.
    expect(weightedFactorScore(factors, FACTOR_WEIGHTS)).toBe(66);
  });

  it("re-ranks: a Tyre-saver lens flips a tyre-strong car above a pace-strong one", () => {
    const paceCar = { pace: 95, consistency: 70, tyre: 30, drivability: 70, mistakes: 70 };
    const tyreCar = { pace: 70, consistency: 70, tyre: 98, drivability: 70, mistakes: 70 };
    const tyre = WEIGHT_PRESETS.find((p) => p.name === "Tyre-saver")!.weights;
    const pace = WEIGHT_PRESETS.find((p) => p.name === "Pace-focused")!.weights;
    // Pace lens favours the pace car; Tyre-saver lens flips the order.
    expect(weightedFactorScore(paceCar, pace)).toBeGreaterThan(weightedFactorScore(tyreCar, pace));
    expect(weightedFactorScore(tyreCar, tyre)).toBeGreaterThan(weightedFactorScore(paceCar, tyre));
  });

  it("normalises non-summing weights (stays 0–100)", () => {
    // Double every weight → same result (normalised), still bounded.
    const doubled = { pace: 0.7, consistency: 0.5, tyre: 0.3, drivability: 0.3, mistakes: 0.2 };
    expect(weightedFactorScore(factors, doubled)).toBe(66);
  });
});

// --- weights presets ---------------------------------------------------------

describe("weights", () => {
  it("every preset sums to 1.0", () => {
    for (const p of WEIGHT_PRESETS) {
      const sum = p.weights.pace + p.weights.consistency + p.weights.tyre + p.weights.drivability + p.weights.mistakes;
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("the default config equals the base FACTOR_WEIGHTS", () => {
    expect(DEFAULT_WEIGHTS_CONFIG.weights).toEqual({ ...FACTOR_WEIGHTS });
  });

  it("normalizeWeights makes any positive set sum to 1", () => {
    const n = normalizeWeights({ pace: 50, consistency: 20, tyre: 10, drivability: 10, mistakes: 10 });
    const sum = n.pace + n.consistency + n.tyre + n.drivability + n.mistakes;
    expect(sum).toBeCloseTo(1, 6);
    expect(n.pace).toBeCloseTo(0.5, 6);
  });

  it("normalizeWeights falls back to defaults for an all-zero set", () => {
    expect(normalizeWeights({ pace: 0, consistency: 0, tyre: 0, drivability: 0, mistakes: 0 })).toEqual({
      ...FACTOR_WEIGHTS,
    });
  });
});
