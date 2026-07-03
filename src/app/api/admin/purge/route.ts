import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/purge → hard fresh-start: deletes ALL logged sessions (and
 * their tyre rows). Cars, tracks, benchmarks, eras, races and settings survive.
 * Requires body { confirm: "PURGE" } so it can't fire by accident.
 * (Phase 1: gated client-side to Admin; server-side auth lands with OAuth.)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.confirm !== "PURGE") {
    return NextResponse.json(
      { error: 'Confirmation required: send { "confirm": "PURGE" }.' },
      { status: 400 },
    );
  }

  const store = getStore();
  await store.init();
  const removed = await store.purgeSessions();
  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, sessions_removed: removed, recompute });
}
