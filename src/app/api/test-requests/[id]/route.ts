import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/test-requests/:id → clear a test request (the data landed, or it's stale). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const reqId = Number(id);
  if (!Number.isInteger(reqId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const store = getStore();
  await store.init();
  const ok = await store.deleteTestRequest(reqId);
  if (!ok) return NextResponse.json({ error: "Test request not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
