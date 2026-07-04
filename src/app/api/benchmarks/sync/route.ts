import { NextResponse } from "next/server";
import { DEFAULT_WET_PENALTY_PCT, deriveWetBenchmarks, syncBenchmarks, WET_PENALTY_SETTING } from "@/lib/benchmark-sync";
import { getStore } from "@/lib/db";
import { postDiscord } from "@/lib/discord";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/benchmarks/sync → pull dry benchmark tiers from the public sheet,
 * then regenerate the derived Wet tiers from them at the stored penalty.
 * Never breaks rankings: on failure it keeps cached/seeded data. Recomputes
 * only if rows actually changed.
 */
export async function POST() {
  const store = getStore();
  await store.init();
  const result = await syncBenchmarks(store);
  if (result.upserted > 0) {
    const pct = (await store.getSetting<number>(WET_PENALTY_SETTING)) ?? DEFAULT_WET_PENALTY_PCT;
    await deriveWetBenchmarks(store, pct);
    await recomputeAll(store);
  }
  // New circuits/layouts appearing on the sheet are real news; routine re-syncs
  // stay quiet (ranking flips they cause are announced by the recompute itself).
  if (result.created_tracks.length > 0) {
    await postDiscord(
      `🆕 **New track${result.created_tracks.length === 1 ? "" : "s"} on the Ohne Speed sheet:** ${result.created_tracks.join(", ")}\nBenchmarks loaded — the coverage map has fresh gaps to close.`,
      store,
    );
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 202 });
}
