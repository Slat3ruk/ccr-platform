import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";
import { DEFAULT_WEIGHTS_CONFIG, normalizeWeights, WEIGHT_PRESETS } from "@/lib/scoring";
import type { FactorWeights, WeightsConfig } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEYS: (keyof FactorWeights)[] = ["pace", "consistency", "tyre", "drivability", "mistakes"];

function isWeights(w: unknown): w is FactorWeights {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  return KEYS.every((k) => typeof o[k] === "number" && Number.isFinite(o[k] as number) && (o[k] as number) >= 0);
}

/** GET /api/rankings/weights → the active weighting + the selectable presets. */
export async function GET() {
  const store = getStore();
  await store.init();
  const active = (await store.getSetting<WeightsConfig>("weights")) ?? DEFAULT_WEIGHTS_CONFIG;
  return NextResponse.json({ active, presets: WEIGHT_PRESETS });
}

/**
 * POST /api/rankings/weights → set the global weighting and recompute rankings.
 * Body: { preset: "<name>" } for a known preset, or { weights: {...}, preset?: "Custom" }
 * for a custom set (normalised to sum 1). Applies to everyone (one shared ranking).
 * Admin only.
 */
export async function POST(req: Request) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["admin"]);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { preset?: unknown; weights?: unknown };
  const store = getStore();
  await store.init();

  const presetName = typeof body.preset === "string" ? body.preset.trim() : null;
  const known = presetName ? WEIGHT_PRESETS.find((p) => p.name === presetName) : null;

  let config: WeightsConfig;
  if (body.weights !== undefined) {
    if (!isWeights(body.weights)) {
      return NextResponse.json({ error: "weights must contain non-negative numbers for all five factors." }, { status: 400 });
    }
    config = { preset: presetName || "Custom", weights: normalizeWeights(body.weights) };
  } else if (known) {
    config = { preset: known.name, weights: { ...known.weights } };
  } else {
    return NextResponse.json({ error: "Provide a known preset name or a full weights object." }, { status: 400 });
  }

  await store.setSetting("weights", config);
  const recompute = await recomputeAll(store, Date.now(), config);
  return NextResponse.json({ ok: true, active: config, recompute });
}
