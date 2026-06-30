import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/rankings/recompute → rebuild all recommendations from sessions. */
export async function POST() {
  const store = getStore();
  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, recompute });
}
