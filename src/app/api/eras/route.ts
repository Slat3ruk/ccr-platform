import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/eras → all eras, oldest first. */
export async function GET() {
  const store = getStore();
  await store.init();
  return NextResponse.json(await store.listEras());
}

/**
 * POST /api/eras → draw a new line in the sand, then recompute so the live
 * board immediately scopes to the new era. Body: { name, starts_at?, reason? }.
 * starts_at defaults to now; backdating is allowed (e.g. "the patch dropped
 * Tuesday"). (Phase 1: gated client-side to Admin.)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Era name is required." }, { status: 400 });

  let starts_at = new Date().toISOString();
  if (typeof body.starts_at === "string" && body.starts_at.trim()) {
    const parsed = Date.parse(body.starts_at);
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: "starts_at must be a valid date/time." }, { status: 400 });
    }
    starts_at = new Date(parsed).toISOString();
  }

  const store = getStore();
  await store.init();
  const era = await store.createEra({
    name,
    starts_at,
    reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null,
    created_by: typeof body.created_by === "string" && body.created_by.trim() ? body.created_by.trim() : null,
  });

  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, era, recompute }, { status: 201 });
}
