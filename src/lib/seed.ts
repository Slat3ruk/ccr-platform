// ============================================================================
// Seeding service — populates cars, tracks, and placeholder Dry benchmarks.
// Idempotent: every underlying write upserts, so running it repeatedly is safe.
// Invoked by POST /api/seed and by scripts/seed.ts.
// ============================================================================

import type { RacingClass } from "@/types";
import type { Store } from "./db/types";
import {
  CLASS_PACE_MULTIPLIER,
  SEED_BENCHMARK_CLASSES,
  SEED_CARS,
  SEED_TRACKS,
  TIER_MULTIPLIER,
} from "./seed-data";

export interface SeedSummary {
  cars: number;
  tracks: number;
  benchmarks: number;
}

export async function seedDatabase(store: Store): Promise<SeedSummary> {
  await store.init();

  for (const c of SEED_CARS) {
    await store.createCar(c.name, c.category);
  }

  let benchmarks = 0;
  for (const t of SEED_TRACKS) {
    const track = await store.createTrack(t.name, null, t.country ?? null);
    for (const cls of SEED_BENCHMARK_CLASSES) {
      const mult = CLASS_PACE_MULTIPLIER[cls] ?? 1.16;
      const alien = t.lmhAlien * mult;
      await store.upsertBenchmark({
        track_id: track.id,
        class: cls as RacingClass,
        condition: "Dry",
        alien_time: round3(alien * TIER_MULTIPLIER.alien),
        competitive_time: round3(alien * TIER_MULTIPLIER.competitive),
        good_time: round3(alien * TIER_MULTIPLIER.good),
        midpack_time: round3(alien * TIER_MULTIPLIER.midpack),
        tail_ender_time: round3(alien * TIER_MULTIPLIER.tail_ender),
        offline_time: round3(alien * TIER_MULTIPLIER.offline),
        data_readiness_pct: 25, // placeholder confidence until real sync
        patch_version: "seed",
      });
      benchmarks++;
    }
  }

  return { cars: SEED_CARS.length, tracks: SEED_TRACKS.length, benchmarks };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
