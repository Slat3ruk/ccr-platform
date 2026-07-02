import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";
import { validateSessionInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/sessions/:id */
export async function GET(_req: Request, ctx: Ctx) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const store = getStore();
  await store.init();
  const session = await store.getSession(id);
  if (!session) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(session);
}

/** PUT /api/sessions/:id → full update (same shape/validation as create), then recompute. */
export async function PUT(req: Request, ctx: Ctx) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const raw = await req.json().catch(() => null);
  const result = validateSessionInput(raw);
  if (!result.valid || !result.data) {
    return NextResponse.json({ error: "Validation failed", details: result.errors }, { status: 400 });
  }
  const input = result.data;

  const store = getStore();
  await store.init();

  const existing = await store.getSession(id);
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [car, track] = await Promise.all([store.getCar(input.car_id), store.getTrack(input.track_id)]);
  if (!car) return NextResponse.json({ error: "Unknown car_id." }, { status: 400 });
  if (!track) return NextResponse.json({ error: "Unknown track_id." }, { status: 400 });

  const driver = await store.getOrCreateDriver(input.driver_name);

  const updated = await store.updateSession(id, {
    driver_id: driver.id,
    car_id: input.car_id,
    track_id: input.track_id,
    session_type: input.session_type,
    condition_reported: input.condition_reported,
    patch_version: input.patch_version ?? null,
    lap_count: input.lap_count,
    best_lap_time: input.best_lap_time,
    avg_lap_time: input.avg_lap_time,
    off_track_count: input.off_track_count,
    off_track_penalty_points: 0,
    confidence_rating: input.confidence_rating,
    setup_version: input.setup_version ?? null,
    comments: input.comments ?? null,
    tyre_fl_pct_remaining: input.tyre_fl_pct_remaining,
    tyre_fr_pct_remaining: input.tyre_fr_pct_remaining,
    tyre_rl_pct_remaining: input.tyre_rl_pct_remaining,
    tyre_rr_pct_remaining: input.tyre_rr_pct_remaining,
  });
  if (!updated) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, session: updated, recompute });
}

/** DELETE /api/sessions/:id → delete, then recompute. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const store = getStore();
  await store.init();
  const removed = await store.deleteSession(id);
  if (!removed) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, recompute });
}
