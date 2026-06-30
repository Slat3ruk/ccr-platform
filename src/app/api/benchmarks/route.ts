import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/benchmarks → all cached benchmark tiers. */
export async function GET() {
  const store = getStore();
  await store.init();
  return NextResponse.json(await store.listBenchmarks());
}
