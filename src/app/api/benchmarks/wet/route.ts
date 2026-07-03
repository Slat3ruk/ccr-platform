import { NextResponse } from "next/server";
import { DEFAULT_WET_PENALTY_PCT, deriveWetBenchmarks, WET_PENALTY_SETTING } from "@/lib/benchmark-sync";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/benchmarks/wet → the current wet pace penalty (%). */
export async function GET() {
  const store = getStore();
  await store.init();
  const pct = (await store.getSetting<number>(WET_PENALTY_SETTING)) ?? DEFAULT_WET_PENALTY_PCT;
  return NextResponse.json({ penalty_pct: pct, default_pct: DEFAULT_WET_PENALTY_PCT });
}

/**
 * POST /api/benchmarks/wet → set the wet penalty and regenerate the derived Wet
 * benchmark tiers (dry × (1 + pct/100)) from the current dry sheets, then
 * recompute rankings. Body: { penalty_pct: number } (0–30).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { penalty_pct?: unknown };
  const pct = Number(body.penalty_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
    return NextResponse.json({ error: "penalty_pct must be a number between 0 and 30." }, { status: 400 });
  }

  const store = getStore();
  await store.init();
  await store.setSetting(WET_PENALTY_SETTING, pct);
  const derived = await deriveWetBenchmarks(store, pct);
  await recomputeAll(store);

  return NextResponse.json({ ok: true, penalty_pct: pct, derived });
}
