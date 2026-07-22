import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { sessionsToCsv } from "@/lib/csv";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/export → every logged session as CSV. Manager/Admin.
 *
 * A readable season archive / spreadsheet feed. It is NOT the backup of record
 * — that's the nightly pg_dump (see DEPLOY.md), which round-trips into a live
 * database. This can't be restored from; it's for humans and Excel.
 */
export async function GET() {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const store = getStore();
  await store.init();

  const [sessions, drivers, cars, tracks] = await Promise.all([
    store.listSessions(),
    store.listDrivers(),
    store.listCars(),
    store.listTracks(),
  ]);

  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const carById = new Map(cars.map((c) => [c.id, c]));
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const csv = sessionsToCsv(sessions, {
    driverName: (id) => driverById.get(id)?.name ?? `#${id}`,
    carName: (id) => carById.get(id)?.name ?? `#${id}`,
    carClass: (id) => carById.get(id)?.category ?? "",
    trackName: (id) => trackById.get(id)?.name ?? `#${id}`,
    trackKm: (id) => trackById.get(id)?.length_km ?? null,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  // Leading BOM: without it Excel reads the file as ANSI and mangles accents
  // (Portimão, driver names, comments). Sheets/LibreOffice ignore it.
  const BOM = String.fromCharCode(0xfeff);
  return new Response(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ccr-sessions-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
