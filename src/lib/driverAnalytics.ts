// ============================================================================
// Driver leaderboard — aggregates the SAME per-session factor scores used by
// the car rankings, but grouped by driver_id instead of (car, track, condition).
// Purely for fun/friendly-competition: "who's fastest", "who kills tyres",
// "who's the best all-rounder" across everything a driver has logged. Scoped
// to the current era by the caller (same scoping as the live rankings board).
// ============================================================================

import type { BadgeDef, BadgeHolder, Benchmark, Car, ConsistencyPoint, Driver, DriverStat, RacingClass, Session } from "@/types";
import { categoryToClass } from "@/types";
import { MIN_SESSIONS_FOR_BADGE, scoreSession, sessionValueScore, stdDev } from "./scoring";

/** Benchmark lookup identical to scoreGroups' fallback (dedicated sheet, else Dry). */
function findBenchmark(benchmarks: Benchmark[], trackId: number, cls: RacingClass, condition: Session["condition_reported"]): Benchmark | null {
  return (
    benchmarks.find((b) => b.track_id === trackId && b.class === cls && b.condition === condition) ??
    benchmarks.find((b) => b.track_id === trackId && b.class === cls && b.condition === "Dry") ??
    null
  );
}

/**
 * Per-driver aggregate stats across every session they've logged in the given
 * set (already era-scoped by the caller). Each session's factors are weighted
 * by its own Session Value Score, same principle as car aggregation — a messy
 * 2-lap test shouldn't count as much as a clean full race.
 */
export function computeDriverStats(sessions: Session[], drivers: Driver[], cars: Car[], benchmarks: Benchmark[], nowMs: number): DriverStat[] {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const carById = new Map(cars.map((c) => [c.id, c]));

  const byDriver = new Map<number, Session[]>();
  for (const s of sessions) {
    const arr = byDriver.get(s.driver_id);
    if (arr) arr.push(s);
    else byDriver.set(s.driver_id, [s]);
  }

  const stats: DriverStat[] = [];
  for (const [driverId, list] of byDriver) {
    const driver = driverById.get(driverId);
    if (!driver) continue;

    const scored = list.map((s) => {
      const car = carById.get(s.car_id);
      const cls: RacingClass = car ? categoryToClass(car.category) : "LMGT3";
      const benchmark = findBenchmark(benchmarks, s.track_id, cls, s.condition_reported);
      return { session: s, factors: scoreSession(s, benchmark), svs: sessionValueScore(s, nowMs).score };
    });

    const totalSvs = scored.reduce((a, s) => a + s.svs, 0);
    const weightOf = (svs: number) => (totalSvs > 0 ? svs : 1);
    const weightSum = totalSvs > 0 ? totalSvs : scored.length;
    const wAvg = (pick: (f: (typeof scored)[number]["factors"]) => number) =>
      scored.reduce((a, s) => a + pick(s.factors) * weightOf(s.svs), 0) / weightSum;

    const avg_pace = wAvg((f) => f.pace);
    const avg_consistency = wAvg((f) => f.consistency);
    const avg_tyre = wAvg((f) => f.tyre);
    const avg_mistakes = wAvg((f) => f.mistakes);
    const avg_drivability = wAvg((f) => f.drivability);

    const consistency_trend: ConsistencyPoint[] = [...list]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .map((s) => ({
        session_id: s.id,
        created_at: s.created_at,
        consistency: scored.find((x) => x.session.id === s.id)!.factors.consistency,
      }));

    stats.push({
      driver_id: driverId,
      driver_name: driver.name,
      sessions_used: list.length,
      total_laps: list.reduce((a, s) => a + s.lap_count, 0),
      avg_pace: round1(avg_pace),
      avg_consistency: round1(avg_consistency),
      avg_tyre: round1(avg_tyre),
      avg_mistakes: round1(avg_mistakes),
      balance_spread: round1(stdDev([avg_pace, avg_consistency, avg_tyre, avg_drivability, avg_mistakes])),
      consistency_trend,
    });
  }

  return stats.sort((a, b) => b.sessions_used - a.sessions_used);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

const TIERS: BadgeHolder["tier"][] = ["gold", "silver", "bronze"];

/** Top-3 by `metric`; `higherIsBetter=false` flips the sort for roast badges. */
function topThree(stats: DriverStat[], metric: (d: DriverStat) => number, higherIsBetter: boolean, minSessions: number): BadgeHolder[] {
  const eligible = stats.filter((d) => d.sessions_used >= minSessions);
  const sorted = [...eligible].sort((a, b) => {
    const diff = higherIsBetter ? metric(b) - metric(a) : metric(a) - metric(b);
    if (diff !== 0) return diff;
    return b.sessions_used - a.sessions_used; // tie-break: more proof wins
  });
  return sorted.slice(0, 3).map((d, i) => ({
    tier: TIERS[i],
    driver_id: d.driver_id,
    driver_name: d.driver_name,
    value: metric(d),
  }));
}

/**
 * The V1 badge catalog. Each badge ranks drivers by one existing factor
 * average (or a derived spread/volume metric) and crowns the top 3 who've
 * cleared MIN_SESSIONS_FOR_BADGE — except Iron Man, which IS the volume proof
 * and would be circular to gate on session count.
 */
export function computeBadges(stats: DriverStat[]): BadgeDef[] {
  const defs: BadgeDef[] = [
    {
      id: "fastest",
      label: "Fastest Overall",
      emoji: "🏆",
      hint: "Highest average Pace factor across every logged session",
      roast: false,
      holders: topThree(stats, (d) => d.avg_pace, true, MIN_SESSIONS_FOR_BADGE),
    },
    {
      id: "consistent",
      label: "Mr/Mrs Consistent",
      emoji: "🎯",
      hint: "Highest average Consistency factor",
      roast: false,
      holders: topThree(stats, (d) => d.avg_consistency, true, MIN_SESSIONS_FOR_BADGE),
    },
    {
      id: "tyre_whisperer",
      label: "Tyre Whisperer",
      emoji: "🛞",
      hint: "Highest average Tyre factor — gentlest on the rubber",
      roast: false,
      holders: topThree(stats, (d) => d.avg_tyre, true, MIN_SESSIONS_FOR_BADGE),
    },
    {
      id: "all_rounder",
      label: "All-Rounder",
      emoji: "⚖️",
      hint: "Smallest spread across their own 5 factor averages — no weak spot",
      roast: false,
      holders: topThree(stats, (d) => d.balance_spread, false, MIN_SESSIONS_FOR_BADGE),
    },
    {
      id: "iron_man",
      label: "Iron Man",
      emoji: "🪖",
      hint: "Most sessions logged this era",
      roast: false,
      holders: topThree(stats, (d) => d.sessions_used, true, 1),
    },
    {
      id: "tyre_killer",
      label: "Tyre Killer",
      emoji: "🔥",
      hint: "Lowest average Tyre factor — hardest on the rubber",
      roast: true,
      holders: topThree(stats, (d) => d.avg_tyre, false, MIN_SESSIONS_FOR_BADGE),
    },
    {
      id: "lawn_mower",
      label: "Lawn Mower",
      emoji: "🌾",
      hint: "Lowest average Mistakes factor — most time spent in the scenery",
      roast: true,
      holders: topThree(stats, (d) => d.avg_mistakes, false, MIN_SESSIONS_FOR_BADGE),
    },
  ];
  return defs;
}
