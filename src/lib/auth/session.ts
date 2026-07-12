import { headers } from "next/headers";
import type { Role } from "@/lib/auth/types";

export interface VerifiedSession {
  discordId: string;
  name: string;
  role: Role;
}

/**
 * The identity middleware.ts already verified for this request, read back out
 * of the headers it set. Only call from a Route Handler or Server Component —
 * middleware.ts runs first for every non-static path (see its matcher), so
 * these headers are always present by the time a handler executes.
 */
export async function getVerifiedSession(): Promise<VerifiedSession> {
  const h = await headers();
  const discordId = h.get("x-ccr-discord-id");
  const role = h.get("x-ccr-role") as Role | null;
  if (!discordId || !role) {
    throw new Error("No verified session on this request — did middleware.ts run?");
  }
  return { discordId, name: h.get("x-ccr-name") ?? "", role };
}
