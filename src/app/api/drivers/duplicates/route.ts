import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { findDuplicateDrivers } from "@/lib/duplicate-drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drivers/duplicates → drivers who look like the same person.
 * Manager/Admin. READ-ONLY — this reports, it never merges.
 *
 * Also returns every driver, so the UI can offer a manual pair-merge for the
 * cases name-matching deliberately won't catch (e.g. "Darren" vs "Dazza").
 */
export async function GET() {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const store = getStore();
  await store.init();
  const [drivers, sessions] = await Promise.all([store.listDrivers(), store.listSessions()]);

  const counts = new Map<number, number>();
  for (const s of sessions) counts.set(s.driver_id, (counts.get(s.driver_id) ?? 0) + 1);

  return NextResponse.json({
    groups: findDuplicateDrivers(drivers, sessions),
    all_drivers: drivers
      .map((d) => ({
        id: d.id,
        name: d.name,
        discord_id: d.discord_id ?? null,
        sessions: counts.get(d.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    total_drivers: drivers.length,
  });
}
