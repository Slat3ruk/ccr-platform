import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC endpoint — the one route middleware.ts exempts from auth (see the
// /api/public/ carve-out there). Serves only non-sensitive team-wide
// aggregates for the public website's home-page stats; never per-driver or
// per-session data. CORS is open because the consumer is the (different-origin)
// crosscurrentracing.com homepage, and the payload is intentionally public.
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

/**
 * GET /api/public/stats → team-wide totals for the website home page.
 *
 * `{ totalLaps, sessionCount, totalKm, kmCoverage: { laps, ofLaps, complete } }`
 *
 * `totalKm` is Σ(lap_count × track.length_km), rounded to whole km. Every track
 * has a MEASURED length as of 2026-08-01 (see lib/track-km.ts), so today that
 * covers every logged lap.
 *
 * ⚠ It counts ONLY laps on tracks that have a length, and reports how many via
 * `kmCoverage`. A new circuit can arrive from a benchmark sync before anyone
 * measures it, and a silently partial total would under-report distance with no
 * way for the consumer to tell — the exact failure shape this codebase keeps
 * getting bitten by. `complete` is false whenever any lap was excluded, so the
 * website can footnote or hide the figure rather than publish a quietly wrong
 * number. `totalLaps` still counts everything and is unchanged.
 */
export async function GET() {
  const store = getStore();
  await store.init();

  const [sessions, tracks] = await Promise.all([store.listSessions(), store.listTracks()]);
  const kmById = new Map(
    tracks.filter((t) => t.length_km != null).map((t) => [t.id, t.length_km as number]),
  );

  let totalLaps = 0;
  let countedLaps = 0;
  let totalKm = 0;
  for (const s of sessions) {
    const laps = Number(s.lap_count) || 0;
    totalLaps += laps;
    const km = kmById.get(s.track_id);
    if (km == null) continue; // unmeasured track — excluded, and surfaced below
    countedLaps += laps;
    totalKm += laps * km;
  }

  return NextResponse.json(
    {
      totalLaps,
      sessionCount: sessions.length,
      totalKm: Math.round(totalKm),
      kmCoverage: { laps: countedLaps, ofLaps: totalLaps, complete: countedLaps === totalLaps },
    },
    { headers: HEADERS },
  );
}
