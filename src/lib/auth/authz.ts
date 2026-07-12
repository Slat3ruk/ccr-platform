import { NextResponse } from "next/server";
import type { Role } from "@/lib/auth/types";

/** Returns a 403 response if `role` isn't in `allowed`, else null (proceed). */
export function forbidUnless(role: Role, allowed: Role[]): NextResponse | null {
  if (allowed.includes(role)) return null;
  return NextResponse.json({ error: `Forbidden — requires ${allowed.join("/")}.` }, { status: 403 });
}
