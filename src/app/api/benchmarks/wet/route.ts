import {
  DEFAULT_WET_PENALTY_PCT,
  deriveWetBenchmarks,
  WET_PENALTY_OVERRIDES_SETTING,
  WET_PENALTY_SETTING,
} from "@/lib/benchmark-sync";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/benchmarks/wet → the global wet pace penalty (%) + any per-track overrides. */
export async function GET() {
  const store = getStore();
  await store.init();
  const pct = (await store.getSetting<number>(WET_PENALTY_SETTING)) ?? DEFAULT_WET_PENALTY_PCT;
  const overrides = (await store.getSetting<Record<string, number>>(WET_PENALTY_OVERRIDES_SETTING)) ?? {};
  return NextResponse.json({ penalty_pct: pct, default_pct: DEFAULT_WET_PENALTY_PCT, overrides });
}

/** Validate a { [track_id]: pct } map — integer keys, 0–30 numeric values. Drops junk. */
function cleanOverrides(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(k);
    const pct = Number(v);
    if (Number.isInteger(id) && id > 0 && Number.isFinite(pct) && pct >= 0 && pct <= 30) out[id] = pct;
  }
  return out;
}

/**
 * POST /api/benchmarks/wet → set the global wet penalty and/or per-track
 * overrides, regenerate the derived Wet tiers (dry × (1 + pct/100), per-track pct
 * where set), then recompute rankings. Body: { penalty_pct?: number,
 * overrides?: { [track_id]: pct } }. Both optional; whatever's sent is applied.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { penalty_pct?: unknown; overrides?: unknown };
  const store = getStore();
  await store.init();

  let pct = (await store.getSetting<number>(WET_PENALTY_SETTING)) ?? DEFAULT_WET_PENALTY_PCT;
  if (body.penalty_pct !== undefined) {
    pct = Number(body.penalty_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
      return NextResponse.json({ error: "penalty_pct must be a number between 0 and 30." }, { status: 400 });
    }
    await store.setSetting(WET_PENALTY_SETTING, pct);
  }

  let overrides = (await store.getSetting<Record<string, number>>(WET_PENALTY_OVERRIDES_SETTING)) ?? {};
  if (body.overrides !== undefined) {
    overrides = cleanOverrides(body.overrides);
    await store.setSetting(WET_PENALTY_OVERRIDES_SETTING, overrides);
  }

  const derived = await deriveWetBenchmarks(store, pct, overrides);
  await recomputeAll(store);

  return NextResponse.json({ ok: true, penalty_pct: pct, overrides, derived });
}
