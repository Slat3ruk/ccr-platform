import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import type { Condition, NewRaceInput, RacingClass, RaceRow } from "@/types";
import { CONDITIONS, RACING_CLASSES } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/races → all races (soonest first) joined with track name. */
export async function GET() {
  const store = getStore();
  await store.init();
  const [races, tracks] = await Promise.all([store.listRaces(), store.listTracks()]);
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const rows: RaceRow[] = races.map((r) => ({
    ...r,
    track_name: trackById.get(r.track_id)?.name ?? `Track #${r.track_id}`,
  }));
  return NextResponse.json(rows);
}

/** POST /api/races → add a race weekend. Manager/Admin. */
export async function POST(req: Request) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const track_id = Number(body.track_id);
  const event_date = typeof body.event_date === "string" ? body.event_date.trim() : "";

  if (!Number.isInteger(track_id) || track_id <= 0) {
    return NextResponse.json({ error: "A valid track_id is required." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
    return NextResponse.json({ error: "event_date must be an ISO date (YYYY-MM-DD)." }, { status: 400 });
  }

  const store = getStore();
  await store.init();
  const track = await store.getTrack(track_id);
  if (!track) return NextResponse.json({ error: "Unknown track_id." }, { status: 400 });

  const cls = typeof body.class === "string" && RACING_CLASSES.includes(body.class as RacingClass) ? (body.class as RacingClass) : null;
  const condition =
    typeof body.condition === "string" && CONDITIONS.includes(body.condition as Condition) ? (body.condition as Condition) : null;

  // Optional absolute start instant — the client sends a full ISO UTC timestamp
  // (converted from the manager's local time). Normalise to canonical UTC.
  let start_at: string | null = null;
  if (typeof body.start_at === "string" && body.start_at.trim()) {
    const ms = Date.parse(body.start_at);
    if (!Number.isFinite(ms)) return NextResponse.json({ error: "start_at must be a valid ISO timestamp." }, { status: 400 });
    start_at = new Date(ms).toISOString();
  }

  const input: NewRaceInput = {
    track_id,
    event_date,
    start_at,
    class: cls,
    condition,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : null,
    created_by: typeof body.created_by === "string" && body.created_by.trim() ? body.created_by.trim() : null,
  };

  const race = await store.createRace(input);
  return NextResponse.json({ ok: true, race }, { status: 201 });
}
