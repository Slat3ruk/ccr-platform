import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** GET /api/sessions/:id */
export async function GET(_req: Request, ctx: Ctx) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const store = getStore();
  await store.init();
  const session = await store.getSession(id);
  if (!session) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(session);
}

/** PUT /api/sessions/:id → partial update, then recompute. */
export async function PUT(req: Request, ctx: Ctx) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const patch = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const store = getStore();
  await store.init();
  const updated = await store.updateSession(id, patch);
  if (!updated) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, session: updated, recompute });
}

/** DELETE /api/sessions/:id → delete, then recompute. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  const store = getStore();
  await store.init();
  const removed = await store.deleteSession(id);
  if (!removed) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, recompute });
}
