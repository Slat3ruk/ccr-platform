import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { RESULT_VERDICTS, type NewRaceResultInput, type ResultVerdict } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/race-results → all logged race results, newest race first. */
export async function GET() {
  const store = getStore();
  await store.init();
  return NextResponse.json(await store.listRaceResults());
}

/**
 * POST /api/race-results → log how a race went. Body: { track_id, class,
 * raced_on, raced_car_id, verdict, recommended_car_id?, position?, note?,
 * created_by? }. `recommended_car_id` is the board's pick snapshotted by the
 * client at logging time. Manager/Admin.
 */
export async function POST(req: Request) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const track_id = Number(body.track_id);
  const raced_car_id = Number(body.raced_car_id);
  const cls = typeof body.class === "string" ? body.class.trim() : "";
  const raced_on = typeof body.raced_on === "string" ? body.raced_on.trim() : "";
  const verdict = typeof body.verdict === "string" ? (body.verdict as ResultVerdict) : ("" as ResultVerdict);

  const errors: string[] = [];
  if (!Number.isInteger(track_id) || track_id <= 0) errors.push("track_id is required.");
  if (!Number.isInteger(raced_car_id) || raced_car_id <= 0) errors.push("raced_car_id is required.");
  if (!cls) errors.push("class is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raced_on)) errors.push("raced_on must be YYYY-MM-DD.");
  if (!RESULT_VERDICTS.some((v) => v.value === verdict)) {
    errors.push(`verdict must be one of: ${RESULT_VERDICTS.map((v) => v.value).join(", ")}.`);
  }
  if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

  const store = getStore();
  await store.init();

  // Validate referenced rows exist here, matching the sessions endpoint — a clean
  // 400 instead of leaning on the Postgres FK (which would surface as a 500).
  const recommended = Number(body.recommended_car_id);
  const recommended_car_id = Number.isInteger(recommended) && recommended > 0 ? recommended : null;
  const [track, racedCar, recCar] = await Promise.all([
    store.getTrack(track_id),
    store.getCar(raced_car_id),
    recommended_car_id != null ? store.getCar(recommended_car_id) : Promise.resolve(true),
  ]);
  if (!track) return NextResponse.json({ error: "Unknown track_id." }, { status: 400 });
  if (!racedCar) return NextResponse.json({ error: "Unknown raced_car_id." }, { status: 400 });
  if (!recCar) return NextResponse.json({ error: "Unknown recommended_car_id." }, { status: 400 });

  const input: NewRaceResultInput = {
    track_id,
    class: cls as NewRaceResultInput["class"],
    raced_on,
    raced_car_id,
    verdict,
    recommended_car_id,
    position: typeof body.position === "string" && body.position.trim() ? body.position.trim() : null,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
    created_by: typeof body.created_by === "string" && body.created_by.trim() ? body.created_by.trim() : null,
  };

  const result = await store.createRaceResult(input);
  return NextResponse.json({ ok: true, result }, { status: 201 });
}
