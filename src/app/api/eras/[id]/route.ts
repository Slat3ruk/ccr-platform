import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/eras/:id → undo a drawn line. Sessions are untouched (they're
 * assigned by timestamp), so the data simply flows back into the previous era.
 * Recomputes so the board reflects the widened range immediately.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const eraId = Number(id);
  if (!Number.isInteger(eraId) || eraId <= 0) {
    return NextResponse.json({ error: "Bad id." }, { status: 400 });
  }

  const store = getStore();
  await store.init();
  const removed = await store.deleteEra(eraId);
  if (!removed) return NextResponse.json({ error: "Era not found." }, { status: 404 });

  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, recompute });
}
