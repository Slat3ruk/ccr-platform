import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { parseLengthKm } from "@/lib/tracks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/tracks → all tracks. */
export async function GET() {
  const store = getStore();
  await store.init();
  return NextResponse.json(await store.listTracks());
}

/**
 * POST /api/tracks → add a track { name, layout_id?, country?, length_km? }.
 * Manager/Admin only — reference data everyone else's scores are keyed to.
 */
export async function POST(req: Request) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    layout_id?: string;
    country?: string;
    length_km?: unknown;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Track name is required." }, { status: 400 });

  const length = parseLengthKm(body.length_km);
  if (!length.ok) return NextResponse.json({ error: length.error }, { status: 400 });

  const store = getStore();
  await store.init();

  // Names are unique — surface the clash rather than silently upserting, so a
  // typo'd duplicate layout doesn't quietly overwrite an existing track.
  const clash = (await store.listTracks()).find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (clash) {
    return NextResponse.json({ error: `A track named "${clash.name}" already exists.` }, { status: 409 });
  }

  const track = await store.createTrack(name, body.layout_id?.trim() || null, body.country?.trim() || null, length.value);
  return NextResponse.json(track, { status: 201 });
}
