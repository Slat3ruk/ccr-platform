"use client";

// ============================================================================
// Verified session (Phase 2: backed by Discord OAuth + server-side RBAC —
// middleware.ts + AUTH-CONTRACT.md). Read-only from the client's perspective;
// role/identity come from the auth-service via /api/auth/session, not a
// user-settable toggle. Roles map to the planned Discord roles: driver / team
// manager (= engineer in the drivers table) / admin.
// ============================================================================

import { createContext, useContext, useEffect, useState } from "react";
import type { Role } from "@/lib/auth/types";

export type { Role };

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "driver", label: "Driver", hint: "Just the recommendation" },
  { value: "manager", label: "Team Manager", hint: "Full factor breakdown" },
  { value: "admin", label: "Admin", hint: "Debug data + controls" },
];

interface SessionCtx {
  role: Role;
  name: string | null;
  discordId: string | null;
  loading: boolean;
}

// Default to the least-privileged role while the session is loading (or if
// the fetch ever fails) — never flash elevated UI before we know who's asking.
const DEFAULT: SessionCtx = { role: "driver", name: null, discordId: null, loading: true };

const Ctx = createContext<SessionCtx>(DEFAULT);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionCtx>(DEFAULT);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { role: Role; name: string; discordId: string }) => {
        if (!cancelled) setSession({ role: d.role, name: d.name, discordId: d.discordId, loading: false });
      })
      .catch(() => {
        if (!cancelled) setSession((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useRole(): SessionCtx {
  return useContext(Ctx);
}
