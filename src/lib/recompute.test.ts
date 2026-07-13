import { describe, expect, it } from "vitest";
import type { Benchmark, Car, Session } from "@/types";
import { scoreGroups } from "./recompute";
import { DEFAULT_WEIGHTS_CONFIG } from "./scoring";

const NOW = Date.parse("2026-07-01T00:00:00.000Z");

function car(): Car {
  return { id: 1, name: "Test GT3", category: "GT3", created_at: "2026-01-01T00:00:00.000Z" };
}

function bench(): Benchmark {
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
    patch_version: null,
    last_synced_at: "2026-06-01T00:00:00.000Z",
  };
}

let seq = 0;
function sess(setup: string | null, best: number): Session {
  seq += 1;
  const created = new Date(Date.parse("2026-06-01T00:00:00.000Z") + seq * 3_600_000).toISOString();
  return {
    id: seq,
    driver_id: 1,
    car_id: 1,
    track_id: 1,
    session_type: "Race",
    condition_reported: "Dry",
    patch_version: null,
    lap_count: 12,
    best_lap_time: best,
    avg_lap_time: best + 0.5,
    off_track_count: 0,
    off_track_penalty_points: 0,
    confidence_rating: 8,
    setup_version: setup,
    svm_data: null,
    comments: null,
    session_value_score: null,
    value_components: null,
    lap_times: null,
    created_at: created,
    updated_at: created,
    tyres: {
      tyre_fl_pct_remaining: 90,
      tyre_fr_pct_remaining: 90,
      tyre_rl_pct_remaining: 88,
      tyre_rr_pct_remaining: 88,
      avg_wear_pct: 11,
    },
  };
}

function run(sessions: Session[]) {
  return scoreGroups(sessions, [car()], [bench()], DEFAULT_WEIGHTS_CONFIG, NOW).recommendations;
}

describe("scoreGroups — best-setup selection", () => {
  it("ranks the car by its best qualifying setup (higher-scoring setup wins)", () => {
    // Setup B (best lap 103 → pace tier 95) beats Setup A (108 → 85), both with 3 runs.
    const sessions = [
      sess("Setup A", 108),
      sess("Setup A", 108),
      sess("Setup A", 108),
      sess("Setup B", 103),
      sess("Setup B", 103),
      sess("Setup B", 103),
    ];
    const recs = run(sessions);
    expect(recs).toHaveLength(1);
    expect(recs[0].best_setup).toBe("Setup B");
    expect(recs[0].pace_factor).toBe(95); // B's pace, not a blend of both
    expect(recs[0].sessions_used).toBe(3); // only the winning setup's runs
  });

  it("ignores a faster setup that hasn't cleared MIN_SESSIONS_PER_SETUP", () => {
    // Setup A is quicker (103) but only 2 runs; Setup B (108) has 3 → B qualifies, A doesn't.
    const sessions = [
      sess("Setup A", 103),
      sess("Setup A", 103),
      sess("Setup B", 108),
      sess("Setup B", 108),
      sess("Setup B", 108),
    ];
    const recs = run(sessions);
    expect(recs[0].best_setup).toBe("Setup B");
    expect(recs[0].pace_factor).toBe(85);
  });

  it("falls back to a blend when no setup qualifies", () => {
    // 2 + 1 runs across two setups → none reaches 3 → blend all 3, no winning setup.
    const sessions = [sess("Setup A", 103), sess("Setup A", 103), sess("Setup B", 108)];
    const recs = run(sessions);
    expect(recs[0].best_setup).toBeNull();
    expect(recs[0].sessions_used).toBe(3);
  });

  it("blank setups collapse to today's behaviour (one unspecified bucket, no tag)", () => {
    const sessions = [sess(null, 103), sess("", 103), sess("   ", 103)];
    const recs = run(sessions);
    expect(recs[0].best_setup).toBeNull(); // unspecified → no setup name shown
    expect(recs[0].sessions_used).toBe(3);
    expect(recs[0].pace_factor).toBe(95);
  });

  it("keeps setups on different (car,track,condition) combos separate", () => {
    const wet = { ...sess("Setup A", 103), condition_reported: "Wet" as const };
    const recs = run([sess("Setup A", 103), sess("Setup A", 103), sess("Setup A", 103), wet]);
    // Dry combo (3 runs, qualifies) + a separate Wet combo (1 run, blend fallback).
    expect(recs).toHaveLength(2);
    const dry = recs.find((r) => r.condition === "Dry");
    const wetRec = recs.find((r) => r.condition === "Wet");
    expect(dry?.best_setup).toBe("Setup A");
    expect(wetRec?.best_setup).toBeNull();
  });

  it("groups by setup_type when present, regardless of differing setup_version", () => {
    // Same controlled setup type across three DIFFERENT free-text versions →
    // one bucket of 3 that qualifies, keyed by the type (versions are just
    // captured metadata, not a grouping axis).
    const typed = (ver: string, best: number): Session => ({
      ...sess(ver, best),
      setup_type: "Race · Esport",
    });
    const recs = run([typed("1.3.2", 103), typed("1.3.3", 103), typed("GMR001", 103)]);
    expect(recs).toHaveLength(1);
    expect(recs[0].best_setup).toBe("Race · Esport");
    expect(recs[0].sessions_used).toBe(3);
  });

  it("falls back to setup_version grouping for legacy sessions with no setup_type", () => {
    // Pre-dropdown data (setup_type null) still groups by the free-text string.
    const recs = run([sess("Basic V2", 103), sess("Basic V2", 103), sess("Basic V2", 103)]);
    expect(recs[0].best_setup).toBe("Basic V2");
  });
});
