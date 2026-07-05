// ============================================================================
// Session data-quality checks — SOFT, non-blocking sanity flags for plausible-
// but-suspect inputs (typos, dropped telemetry). Everything here is advisory:
// hard-impossible values (avg faster than best, out-of-range %) are rejected by
// validation.ts instead. Pure + shared: the log form shows these before submit
// (confirm, don't block) and the session log flags suspect rows with a ⚠.
// ============================================================================

import { isOlderSetupPatch } from "./patch";
import { formatLapTime } from "./time";

export interface QualityCheckInput {
  best_lap_time: number;
  avg_lap_time: number;
  lap_count: number;
  /** 100 − average tyre % remaining. */
  avg_wear_pct: number;
  /** How many individual lap times were entered (≥2 = provided), else null. */
  lap_times_count?: number | null;
  /** The patch the setup was built on (form field). */
  setup_version?: string | null;
  /** The patch this session is/was logged under (current patch in the form; stored value in the log). */
  patch_version?: string | null;
}

/** Only the two extreme tiers are needed to bracket a plausible lap. */
export interface QualityBenchmark {
  alien_time: number;
  offline_time: number;
}

const NO_WEAR_MIN_LAPS = 8; // a real stint should show some wear
const SLOW_AVG_RATIO = 1.15; // avg >15% off best = suspicious over a real run
const SLOW_AVG_MIN_LAPS = 5;

/**
 * Return human-readable warnings for a session. Empty = looks fine. The
 * benchmark (if known for this car/track/condition) enables the pace-sanity
 * bracket; without it those two checks are skipped.
 */
export function sessionQualityWarnings(s: QualityCheckInput, benchmark?: QualityBenchmark | null): string[] {
  const warnings: string[] = [];

  if (benchmark && s.best_lap_time > 0) {
    if (s.best_lap_time < benchmark.alien_time) {
      warnings.push(
        `Best lap (${formatLapTime(s.best_lap_time)}) is quicker than the alien benchmark (${formatLapTime(benchmark.alien_time)}) — faster than the quickest known time. Double-check it isn't a typo.`,
      );
    } else if (s.best_lap_time > benchmark.offline_time) {
      warnings.push(
        `Best lap (${formatLapTime(s.best_lap_time)}) is slower than the slowest benchmark tier (${formatLapTime(benchmark.offline_time)}) — well off the pace, or a mistyped time?`,
      );
    }
  }

  if (s.avg_wear_pct <= 1 && s.lap_count >= NO_WEAR_MIN_LAPS) {
    warnings.push(`No tyre wear recorded over ${s.lap_count} laps — did the tyre readings come through?`);
  }

  if (s.lap_times_count != null && s.lap_times_count >= 2 && s.lap_times_count !== s.lap_count) {
    warnings.push(`You listed ${s.lap_times_count} individual lap times but set the lap count to ${s.lap_count}.`);
  }

  if (s.best_lap_time > 0 && s.avg_lap_time > s.best_lap_time * SLOW_AVG_RATIO && s.lap_count >= SLOW_AVG_MIN_LAPS) {
    warnings.push(
      `Average lap is more than ${Math.round((SLOW_AVG_RATIO - 1) * 100)}% slower than the best — traffic or an out-lap, or a typo?`,
    );
  }

  if (isOlderSetupPatch(s.setup_version, s.patch_version)) {
    warnings.push(
      `Setup patch (${s.setup_version}) is older than the current patch (${s.patch_version}) — may not reflect current handling; its weight is reduced.`,
    );
  }

  return warnings;
}
