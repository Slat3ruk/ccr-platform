import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@/lib/auth/types";

// See AUTH-CONTRACT.md for the full shape of what ccr-auth.service sets and
// returns. Verified per request against the live endpoint (never trust the
// cookie's own claims for role/membership — the JWT carries no role, and a
// valid cc_session does not by itself mean guild membership).
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? "http://127.0.0.1:8787";
const SESSION_COOKIE = "cc_session";
const LOGIN_URL = "https://crosscurrentracing.com/api/auth/discord/login?returnTo=%2Fapps.html";

interface AuthMeResponse {
  authenticated: boolean;
  id?: string;
  name?: string;
  isMember?: boolean;
  isManager?: boolean;
  isAdmin?: boolean;
}

async function verify(token: string): Promise<AuthMeResponse> {
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as AuthMeResponse;
  } catch {
    // Auth service unreachable — fail closed, not open.
    return { authenticated: false };
  }
}

function roleFrom(session: AuthMeResponse): Role {
  if (session.isAdmin) return "admin";
  if (session.isManager) return "manager";
  return "driver";
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

export async function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verify(token) : { authenticated: false };

  if (!session.authenticated || !session.isMember) {
    if (isApi) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(LOGIN_URL);
  }

  const headers = new Headers(req.headers);
  headers.set("x-ccr-discord-id", session.id ?? "");
  headers.set("x-ccr-name", session.name ?? "");
  headers.set("x-ccr-role", roleFrom(session));

  return NextResponse.next({ request: { headers } });
}
