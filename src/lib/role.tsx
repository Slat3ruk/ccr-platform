"use client";

// ============================================================================
// View-as role (Phase 1: a client-side debug/visibility toggle; Phase 2: backed
// by Discord OAuth + RBAC). Persisted in localStorage. Roles map to the planned
// Discord roles: driver / team manager (= engineer) / admin.
// ============================================================================

import { createContext, useContext, useEffect, useState } from "react";

export type Role = "driver" | "manager" | "admin";

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "driver", label: "Driver", hint: "Just the recommendation" },
  { value: "manager", label: "Team Manager", hint: "Full factor breakdown" },
  { value: "admin", label: "Admin", hint: "Debug data + controls" },
];

interface RoleCtx {
  role: Role;
  setRole: (r: Role) => void;
}

const Ctx = createContext<RoleCtx>({ role: "manager", setRole: () => {} });

const KEY = "ccr-view-role";

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>("manager");

  useEffect(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem(KEY) as Role | null) : null;
    if (saved === "driver" || saved === "manager" || saved === "admin") setRoleState(saved);
  }, []);

  function setRole(r: Role) {
    setRoleState(r);
    try {
      localStorage.setItem(KEY, r);
    } catch {
      /* ignore */
    }
  }

  return <Ctx.Provider value={{ role, setRole }}>{children}</Ctx.Provider>;
}

export function useRole(): RoleCtx {
  return useContext(Ctx);
}
