import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/rankings/recompute → rebuild all recommendations from sessions. Admin only. */
export async function POST() {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["admin"]);
  if (denied) return denied;

  const store = getStore();
  const recompute = await recomputeAll(store);
  return NextResponse.json({ ok: true, recompute });
}
