import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@/lib/auth/types";

// See AUTH-CONTRACT.md for the full shape of what ccr-auth.service sets and
// returns. Verified per request against the live endpoint (never trust the
// cookie's own claims for role/membership — the JWT carries no role, and a
// valid cc_session does not by itself mean guild membership).
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? "http://127.0.0.1:8787";
const SESSION_COOKIE = "cc_session";
const LOGIN_URL = "https://crosscurrentracing.com/api/auth/discord/login?returnTo=%2Fapps.html";

// ── LOCAL DEV BYPASS ────────────────────────────────────────────────────────
// Discord OAuth can only complete against the real domain, so on localhost
// every role-gated page redirects to production and there's no way to work on
// the admin/manager UI. This mints a fake verified identity instead.
//
// It requires BOTH of:
//   1. a non-production build — Next inlines NODE_ENV at build time, so a
//      production build cannot compile into this branch at all, and
//   2. an explicit opt-in, AUTH_DEV_MODE=1 (set it in .env.local, which is
//      gitignored — NEVER in the VPS environment or the systemd unit).
// Either one missing = the normal ccr-auth verification path, unchanged.
//
// This only fakes the *client* side of the trust boundary on a machine the
// developer already controls; it grants nothing they couldn't grant themselves.
// The matching ccr-auth backend contract is AUTH-DEV-MODE-SPEC.md in the
// website repo.
const ROLES: readonly Role[] = ["driver", "manager", "admin"];
const DEV_MODE = process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_MODE === "1";
const DEV_ROLE: Role = ROLES.includes(process.env.AUTH_DEV_ROLE as Role)
  ? (process.env.AUTH_DEV_ROLE as Role)
  : "admin";

if (DEV_MODE) {
  // Module scope: logged once per worker at startup, not per request.
  console.warn(
    `\n⚠  AUTH_DEV_MODE is ON — every request is authenticated as a fake "${DEV_ROLE}".\n` +
      `   Local development only. Never enable this on the server.\n`,
  );
}

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

  // /api/public/* is the ONLY unauthenticated surface: team-wide aggregates
  // (total laps etc.) for the public crosscurrentracing.com homepage, which has
  // no session to present. Prefix-gated so exposing a new route is an explicit
  // act of putting it under /api/public/, never an accident. Nothing per-driver
  // or per-session belongs here.
  if (req.nextUrl.pathname.startsWith("/api/public/")) {
    return NextResponse.next();
  }

  // Local dev only — see the DEV_MODE notes above. Skips the ccr-auth
  // round-trip entirely and injects the same headers a real session would.
  if (DEV_MODE) {
    const devHeaders = new Headers(req.headers);
    devHeaders.set("x-ccr-discord-id", "dev-user");
    devHeaders.set("x-ccr-name", `Dev ${DEV_ROLE}`);
    devHeaders.set("x-ccr-role", DEV_ROLE);
    const devRes = NextResponse.next({ request: { headers: devHeaders } });
    devRes.headers.set("x-ccr-dev-mode", "1"); // visible in devtools so it's never a silent state
    return devRes;
  }

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
