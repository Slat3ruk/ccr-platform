import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { knownTrackKm } from "@/lib/track-km";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tracks/backfill-km → fill in lap distances we know, for tracks that
 * don't have one yet. Manager/Admin.
 *
 * Deliberately NON-DESTRUCTIVE: a track that already has a distance is left
 * completely alone, so running this can never overwrite a figure someone
 * entered by hand (or one that's more accurate than our table). Safe to re-run.
 * Only base layouts are known — variants are reported as `skipped` and stay
 * blank for manual entry. See lib/track-km.ts.
 */
export async function POST() {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const store = getStore();
  await store.init();

  const tracks = await store.listTracks();
  const filled: { name: string; km: number }[] = [];
  const skipped: string[] = [];
  let alreadySet = 0;

  for (const t of tracks) {
    if (t.length_km != null) {
      alreadySet++;
      continue;
    }
    const km = knownTrackKm(t.name);
    if (km == null) {
      skipped.push(t.name);
      continue;
    }
    await store.updateTrack(t.id, { length_km: km });
    filled.push({ name: t.name, km });
  }

  return NextResponse.json({
    ok: true,
    filled,
    already_set: alreadySet,
    skipped,
    message:
      `Filled ${filled.length} lap distance${filled.length === 1 ? "" : "s"}.` +
      (alreadySet ? ` Left ${alreadySet} existing value${alreadySet === 1 ? "" : "s"} untouched.` : "") +
      (skipped.length
        ? ` ${skipped.length} still need${skipped.length === 1 ? "s" : ""} a distance by hand (layout variants we don't have a trustworthy figure for).`
        : ""),
  });
}
