import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/tracks → all tracks. */
export async function GET() {
  const store = getStore();
  await store.init();
  return NextResponse.json(await store.listTracks());
}

/** POST /api/tracks → admin: add a new track { name, layout_id?, country? }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; layout_id?: string; country?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Track name is required." }, { status: 400 });
  const store = getStore();
  await store.init();
  const track = await store.createTrack(name, body.layout_id?.trim() || null, body.country?.trim() || null);
  return NextResponse.json(track, { status: 201 });
}
