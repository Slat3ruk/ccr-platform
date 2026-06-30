import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/drivers → all drivers (no auth in Phase 1). */
export async function GET() {
  const store = getStore();
  await store.init();
  return NextResponse.json(await store.listDrivers());
}
