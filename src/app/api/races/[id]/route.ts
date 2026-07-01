import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import type { Condition, RacingClass } from "@/types";
import { CONDITIONS, RACING_CLASSES } from "@/types";
import type { RacePatch } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/races/:id → update a race. Chiefly used to set the BLUF `note`
 * (with `note_by`), but also edits name/date/class/condition.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raceId = Number(id);
  if (!Number.isInteger(raceId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: RacePatch = {};

  if (typeof body.note === "string") patch.note = body.note;
  if (body.note === null) patch.note = null;
  if (typeof body.note_by === "string") patch.note_by = body.note_by.trim() || null;
  if (typeof body.name === "string") patch.name = body.name.trim() || null;
  if (typeof body.event_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) patch.event_date = body.event_date;
  if (body.class === null || (typeof body.class === "string" && RACING_CLASSES.includes(body.class as RacingClass)))
    patch.class = (body.class as RacingClass) ?? null;
  if (body.condition === null || (typeof body.condition === "string" && CONDITIONS.includes(body.condition as Condition)))
    patch.condition = (body.condition as Condition) ?? null;

  const store = getStore();
  await store.init();
  const race = await store.updateRace(raceId, patch);
  if (!race) return NextResponse.json({ error: "Race not found." }, { status: 404 });
  return NextResponse.json({ ok: true, race });
}

/** DELETE /api/races/:id → remove a race weekend. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raceId = Number(id);
  if (!Number.isInteger(raceId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const store = getStore();
  await store.init();
  const ok = await store.deleteRace(raceId);
  if (!ok) return NextResponse.json({ error: "Race not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
