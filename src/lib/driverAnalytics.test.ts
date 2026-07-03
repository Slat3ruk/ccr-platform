import { describe, expect, it } from "vitest";
import type { Benchmark, Car, Driver, Session } from "@/types";
import { computeBadges, computeDriverStats } from "./driverAnalytics";
import { MIN_SESSIONS_FOR_BADGE } from "./scoring";

const NOW = Date.parse("2026-07-01T00:00:00.000Z");

function car(id = 1): Car {
  return { id, name: "Test GT3", category: "GT3", created_at: "2026-01-01T00:00:00.000Z" };
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
    midpack_time: 120,
    tail_ender_time: 130,
    offline_time: 140,
    data_readiness_pct: 100,
    patch_version: null,
    last_synced_at: "2026-06-01T00:00:00.000Z",
  };
}

function driver(id: number, name: string): Driver {
  return { id, name, role: "driver", trust_score: 50, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" };
}

let seq = 0;
function sess(
  driverId: number,
  opts: { best?: number; avg?: number; offTrack?: number; tyres?: [number, number, number, number]; confidence?: number } = {},
): Session {
  seq += 1;
  const created = new Date(Date.parse("2026-06-01T00:00:00.000Z") + seq * 3_600_000).toISOString();
  const best = opts.best ?? 108;
  const [fl, fr, rl, rr] = opts.tyres ?? [90, 90, 88, 88];
  return {
    id: seq,
    driver_id: driverId,
    car_id: 1,
    track_id: 1,
    session_type: "Race",
    condition_reported: "Dry",
    patch_version: null,
    lap_count: 12,
    best_lap_time: best,
    avg_lap_time: opts.avg ?? best + 0.5,
    off_track_count: opts.offTrack ?? 0,
    off_track_penalty_points: 0,
    confidence_rating: opts.confidence ?? 8,
    setup_version: null,
    svm_data: null,
    comments: null,
    session_value_score: null,
    value_components: null,
    lap_times: null,
    created_at: created,
    updated_at: created,
    tyres: { tyre_fl_pct_remaining: fl, tyre_fr_pct_remaining: fr, tyre_rl_pct_remaining: rl, tyre_rr_pct_remaining: rr, avg_wear_pct: 100 - (fl + fr + rl + rr) / 4 },
  };
}

const DRIVERS = [driver(1, "Dave"), driver(2, "Ash"), driver(3, "Mo")];
const CARS = [car()];
const BENCH = [bench()];

function stats(sessions: Session[]) {
  return computeDriverStats(sessions, DRIVERS, CARS, BENCH, NOW);
}

describe("computeDriverStats", () => {
  it("aggregates per-session factors per driver, blended across all their sessions", () => {
    const sessions = [sess(1, { best: 103 }), sess(1, { best: 103 }), sess(2, { best: 120 })];
    const rows = stats(sessions);
    const dave = rows.find((r) => r.driver_id === 1)!;
    const ash = rows.find((r) => r.driver_id === 2)!;
    expect(dave.sessions_used).toBe(2);
    expect(ash.sessions_used).toBe(1);
    expect(dave.avg_pace).toBeGreaterThan(ash.avg_pace); // 103 beats the benchmark's competitive tier, 120 doesn't
  });

  it("ignores drivers with zero sessions in range", () => {
    const rows = stats([sess(1, {})]);
    expect(rows.find((r) => r.driver_id === 2)).toBeUndefined();
  });

  it("produces a chronologically-ordered consistency trend", () => {
    const rows = stats([sess(1, {}), sess(1, {}), sess(1, {})]);
    const dave = rows.find((r) => r.driver_id === 1)!;
    expect(dave.consistency_trend).toHaveLength(3);
    const times = dave.consistency_trend.map((p) => Date.parse(p.created_at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("computeBadges", () => {
  it("gates fastest/consistent/tyre/all-rounder badges behind MIN_SESSIONS_FOR_BADGE", () => {
    const below = MIN_SESSIONS_FOR_BADGE - 1;
    const sessions = Array.from({ length: below }, () => sess(1, { best: 103 }));
    const rows = stats(sessions);
    const badges = computeBadges(rows);
    const fastest = badges.find((b) => b.id === "fastest")!;
    expect(fastest.holders).toHaveLength(0); // Dave has real pace but not enough proof yet
  });

  it("crowns the fastest driver gold once they clear the session threshold", () => {
    const fastSessions = Array.from({ length: MIN_SESSIONS_FOR_BADGE }, () => sess(1, { best: 103 }));
    const slowSessions = Array.from({ length: MIN_SESSIONS_FOR_BADGE }, () => sess(2, { best: 125 }));
    const rows = stats([...fastSessions, ...slowSessions]);
    const badges = computeBadges(rows);
    const fastest = badges.find((b) => b.id === "fastest")!;
    expect(fastest.holders[0].tier).toBe("gold");
    expect(fastest.holders[0].driver_id).toBe(1);
  });

  it("Tyre Killer picks the LOWEST tyre score, not the highest", () => {
    const gentle = Array.from({ length: MIN_SESSIONS_FOR_BADGE }, () => sess(1, { tyres: [95, 95, 95, 95] }));
    const harsh = Array.from({ length: MIN_SESSIONS_FOR_BADGE }, () => sess(2, { tyres: [40, 40, 35, 35] }));
    const rows = stats([...gentle, ...harsh]);
    const badges = computeBadges(rows);
    const killer = badges.find((b) => b.id === "tyre_killer")!;
    const whisperer = badges.find((b) => b.id === "tyre_whisperer")!;
    expect(killer.holders[0].driver_id).toBe(2); // harshest wins the roast
    expect(whisperer.holders[0].driver_id).toBe(1); // gentlest wins the compliment
  });

  it("Lawn Mower picks the driver with the most off-tracks (lowest mistakes factor)", () => {
    const clean = Array.from({ length: MIN_SESSIONS_FOR_BADGE }, () => sess(1, { offTrack: 0 }));
    const messy = Array.from({ length: MIN_SESSIONS_FOR_BADGE }, () => sess(2, { offTrack: 8 }));
    const rows = stats([...clean, ...messy]);
    const badges = computeBadges(rows);
    const lawnMower = badges.find((b) => b.id === "lawn_mower")!;
    expect(lawnMower.holders[0].driver_id).toBe(2);
  });

  it("Iron Man has no session-count gate — it IS the volume metric", () => {
    const rows = stats([sess(1, {})]); // just 1 session, below MIN_SESSIONS_FOR_BADGE
    const badges = computeBadges(rows);
    const ironMan = badges.find((b) => b.id === "iron_man")!;
    expect(ironMan.holders).toHaveLength(1);
    expect(ironMan.holders[0].driver_id).toBe(1);
  });

  it("All-Rounder rewards the smallest spread across a driver's own factor averages", () => {
    // Driver 1: balanced mid-pack everywhere. Driver 2: blazing pace but terrible tyres/mistakes (spiky).
    const balanced = Array.from({ length: MIN_SESSIONS_FOR_BADGE }, () => sess(1, { best: 115, tyres: [70, 70, 68, 68], offTrack: 1 }));
    const spiky = Array.from({ length: MIN_SESSIONS_FOR_BADGE }, () => sess(2, { best: 101, tyres: [20, 20, 15, 15], offTrack: 10 }));
    const rows = stats([...balanced, ...spiky]);
    const badges = computeBadges(rows);
    const allRounder = badges.find((b) => b.id === "all_rounder")!;
    expect(allRounder.holders[0].driver_id).toBe(1);
  });
});
