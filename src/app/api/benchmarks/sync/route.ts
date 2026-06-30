import { NextResponse } from "next/server";
import { syncBenchmarks } from "@/lib/benchmark-sync";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/benchmarks/sync → pull benchmark tiers from Google Sheets.
 * Never breaks rankings: on failure it keeps cached/seeded data. Recomputes
 * only if rows actually changed.
 */
export async function POST() {
  const store = getStore();
  const result = await syncBenchmarks(store);
  if (result.upserted > 0) {
    await recomputeAll(store);
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 202 });
}
