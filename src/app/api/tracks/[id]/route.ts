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

/**
 * DELETE /api/tracks/:id → remove a track. Manager/Admin.
 *
 * ⚠ THE REFERENCE CHECK BELOW IS LOAD-BEARING. Every table referencing
 * tracks(id) is ON DELETE CASCADE, so deleting a track that's in use silently
 * takes its sessions, benchmarks, recommendations, races, test requests and
 * race results with it. We therefore refuse unless NOTHING references it —
 * which makes this safe for exactly the intended job: removing a track that
 * was added by mistake or duplicated, before anyone logged against it.
 *
 * A track that IS in use should be RENAMED instead (PATCH above): renaming a
 * manually-added track to the name the benchmark sheet uses makes the next
 * sync adopt it, keeping its logged sessions attached.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const { id } = await ctx.params;
  const trackId = Number(id);
  if (!Number.isInteger(trackId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const store = getStore();
  await store.init();

  const track = await store.getTrack(trackId);
  if (!track) return NextResponse.json({ error: "Track not found." }, { status: 404 });

  const [sessions, benchmarks, races, requests, results] = await Promise.all([
    store.listSessions({ track_id: trackId }),
    store.listBenchmarks(),
    store.listRaces(),
    store.listTestRequests(),
    store.listRaceResults(),
  ]);

  const blocking: string[] = [];
  const n = (count: number, one: string, many = `${one}s`) =>
    count === 1 ? `1 ${one}` : `${count} ${many}`;
  if (sessions.length) blocking.push(n(sessions.length, "logged session"));
  const bm = benchmarks.filter((b) => b.track_id === trackId).length;
  if (bm) blocking.push(n(bm, "benchmark row"));
  const rc = races.filter((r) => r.track_id === trackId).length;
  if (rc) blocking.push(n(rc, "race weekend"));
  const tr = requests.filter((r) => r.track_id === trackId).length;
  if (tr) blocking.push(n(tr, "test request"));
  const rr = results.filter((r) => r.track_id === trackId).length;
  if (rr) blocking.push(n(rr, "race result"));

  if (blocking.length) {
    return NextResponse.json(
      {
        error:
          `Can't delete “${track.name}” — it still has ${blocking.join(", ")}. ` +
          `Deleting it would take that data with it. Rename it instead if you're merging a duplicate.`,
        blocking,
      },
      { status: 409 },
    );
  }

  await store.deleteTrack(trackId);
  return NextResponse.json({ ok: true, deleted: track.name });
}
