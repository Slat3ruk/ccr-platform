import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { parseLengthKm } from "@/lib/tracks";
import type { TrackPatch } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/tracks/:id → edit a track (name, layout, country, length_km).
 * Manager/Admin. Chiefly used to backfill lap distances on tracks the
 * benchmark sync created without one.
 *
 * NOTE: no DELETE. Sessions/benchmarks/races reference tracks by id, so
 * removing one would orphan logged data — rename instead.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const { id } = await ctx.params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: TrackPatch = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Track name can't be blank." }, { status: 400 });
    patch.name = name;
  }
  if (body.layout_id === null) patch.layout_id = null;
  else if (typeof body.layout_id === "string") patch.layout_id = body.layout_id.trim() || null;
  if (body.country === null) patch.country = null;
  else if (typeof body.country === "string") patch.country = body.country.trim() || null;

  if ("length_km" in body) {
    const length = parseLengthKm(body.length_km);
    if (!length.ok) return NextResponse.json({ error: length.error }, { status: 400 });
    patch.length_km = length.value;
  }

  const store = getStore();
  await store.init();

  // Names are unique — block a rename that would collide with another track.
  if (patch.name) {
    const clash = (await store.listTracks()).find(
      (t) => t.id !== trackId && t.name.toLowerCase() === patch.name!.toLowerCase(),
    );
    if (clash) return NextResponse.json({ error: `A track named "${clash.name}" already exists.` }, { status: 409 });
  }

  const track = await store.updateTrack(trackId, patch);
  if (!track) return NextResponse.json({ error: "Track not found." }, { status: 404 });
  return NextResponse.json({ ok: true, track });
}
