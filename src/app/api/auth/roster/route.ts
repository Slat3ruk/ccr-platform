import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? "http://127.0.0.1:8787";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/roster → proxies ccr-auth.service's Team Member+ Discord
 * roster, for the log-on-behalf dropdown. Manager/Admin only — gated here
 * AND re-checked by the auth service itself against the forwarded cookie
 * (defense in depth, same as the rest of AUTH-CONTRACT.md's design).
 */
export async function GET(req: Request) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/roster`, {
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) return NextResponse.json({ error: "Roster fetch failed." }, { status: 502 });

  const data = await res.json();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
