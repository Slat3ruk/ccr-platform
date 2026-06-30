import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";
import { seedDatabase } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/seed → store backend + row counts (used by the UI's setup banner). */
export async function GET() {
  const store = getStore();
  await store.init();
  const counts = await store.counts();
  return NextResponse.json({ backend: store.kind, counts });
}

/** POST /api/seed → populate cars/tracks/benchmarks, then recompute. Idempotent. */
export async function POST() {
  const store = getStore();
  const summary = await seedDatabase(store);
  const recompute = await recomputeAll(store);
  const counts = await store.counts();
  return NextResponse.json({ ok: true, backend: store.kind, seeded: summary, recompute, counts });
}
