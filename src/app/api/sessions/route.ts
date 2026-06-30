import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";
import { validateSessionInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sessions?car_id=&track_id=&driver_id=&limit= → filtered list. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const num = (k: string) => {
    const v = url.searchParams.get(k);
    return v != null && v !== "" ? Number(v) : undefined;
  };
  const store = getStore();
  await store.init();
  const sessions = await store.listSessions({
    car_id: num("car_id"),
    track_id: num("track_id"),
    driver_id: num("driver_id"),
    limit: num("limit"),
  });
  return NextResponse.json(sessions);
}

/** POST /api/sessions → log a session, then recompute rankings. */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const result = validateSessionInput(raw);
  if (!result.valid || !result.data) {
    return NextResponse.json({ error: "Validation failed", details: result.errors }, { status: 400 });
  }
  const input = result.data;

  const store = getStore();
  await store.init();

  const [car, track] = await Promise.all([store.getCar(input.car_id), store.getTrack(input.track_id)]);
  if (!car) return NextResponse.json({ error: "Unknown car_id." }, { status: 400 });
  if (!track) return NextResponse.json({ error: "Unknown track_id." }, { status: 400 });

  const driver = await store.getOrCreateDriver(input.driver_name);

  const session = await store.createSession({
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

  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, session, recompute }, { status: 201 });
}
