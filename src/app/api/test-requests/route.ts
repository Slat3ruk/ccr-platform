import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { postDiscord } from "@/lib/discord";
import type { Condition, NewTestRequestInput } from "@/types";
import { CONDITIONS } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/test-requests → all open "please test this" pins (newest first). */
export async function GET() {
  const store = getStore();
  await store.init();
  return NextResponse.json(await store.listTestRequests());
}

/**
 * POST /api/test-requests → pin a (car, track, condition) combo as wanted.
 * De-duplicates: pinning an already-pinned combo just returns the existing one.
 * Fires a #testdrivers webhook so the team sees the ask. (Phase 1: gated
 * client-side to Manager/Admin.)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const car_id = Number(body.car_id);
  const track_id = Number(body.track_id);
  const condition = body.condition as Condition;

  if (!Number.isInteger(car_id) || car_id <= 0) return NextResponse.json({ error: "A valid car_id is required." }, { status: 400 });
  if (!Number.isInteger(track_id) || track_id <= 0) return NextResponse.json({ error: "A valid track_id is required." }, { status: 400 });
  if (!CONDITIONS.includes(condition)) return NextResponse.json({ error: "condition must be Dry, Wet or Mixed." }, { status: 400 });

  const store = getStore();
  await store.init();
  const [car, track] = await Promise.all([store.getCar(car_id), store.getTrack(track_id)]);
  if (!car) return NextResponse.json({ error: "Unknown car_id." }, { status: 400 });
  if (!track) return NextResponse.json({ error: "Unknown track_id." }, { status: 400 });

  // De-dupe on the combo so a double-pin doesn't stack.
  const existing = (await store.listTestRequests()).find(
    (r) => r.car_id === car_id && r.track_id === track_id && r.condition === condition,
  );
  if (existing) return NextResponse.json({ ok: true, request: existing, existed: true });

  const input: NewTestRequestInput = {
    car_id,
    track_id,
    condition,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    created_by: typeof body.created_by === "string" && body.created_by.trim() ? body.created_by.trim() : null,
  };
  const request = await store.createTestRequest(input);

  await postDiscord(
    `📋 **Testing wanted:** ${car.name} @ ${track.name} · ${condition}${input.note ? `\n${input.note}` : ""}\nHelp close the gap — log a run on #log-session within the data logging app.`,
    store,
    "test",
  );

  return NextResponse.json({ ok: true, request }, { status: 201 });
}
