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

/** GET /api/public/stats → { totalLaps, sessionCount } across all logged sessions. */
export async function GET() {
  const store = getStore();
  await store.init();
  const sessions = await store.listSessions();
  const totalLaps = sessions.reduce((n, s) => n + (Number(s.lap_count) || 0), 0);
  return NextResponse.json({ totalLaps, sessionCount: sessions.length }, { headers: HEADERS });
}
