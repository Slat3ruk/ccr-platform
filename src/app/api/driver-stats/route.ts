import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { computeBadges, computeDriverStats } from "@/lib/driverAnalytics";
import { currentEraRange } from "@/lib/eras";
import { sessionsInRange } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/driver-stats → the driver leaderboard: each driver's aggregate
 * factor averages across every session they've logged (current era, all
 * cars/tracks/conditions combined) plus the badge catalog computed from them.
 * Read-only and ad-hoc (no persistence) — cheap at MVP data volumes, same
 * pattern as the archived-era rankings view.
 */
export async function GET() {
  const store = getStore();
  await store.init();

  const [allSessions, drivers, cars, benchmarks, eras] = await Promise.all([
    store.listSessions(),
    store.listDrivers(),
    store.listCars(),
    store.listBenchmarks(),
    store.listEras(),
  ]);

  const nowMs = Date.now();
  const range = currentEraRange(eras, nowMs);
  const sessions = sessionsInRange(allSessions, range);

  const stats = computeDriverStats(sessions, drivers, cars, benchmarks, nowMs);
  const badges = computeBadges(stats);

  return NextResponse.json({ stats, badges });
}
