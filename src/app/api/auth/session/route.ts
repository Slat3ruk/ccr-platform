import { NextResponse } from "next/server";
import { getVerifiedSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/session → the verified identity for the current request, for client components (see lib/role.tsx). */
export async function GET() {
  const session = await getVerifiedSession();
  return NextResponse.json(session, { headers: { "Cache-Control": "no-store" } });
}
