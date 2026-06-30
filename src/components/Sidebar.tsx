"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROLES, useRole } from "@/lib/role";

const NAV = [
  { href: "/", label: "rankings", icon: "🏆" },
  { href: "/log", label: "log-session", icon: "📝" },
  { href: "/sessions", label: "session-log", icon: "📋" },
  { href: "/benchmarks", label: "benchmarks", icon: "📊" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { role, setRole } = useRole();
  const current = ROLES.find((r) => r.value === role) ?? ROLES[1];
  return (
    <aside className="sidebar">
      <div className="sidebar-header">CrossCurrent Racing</div>
      <div className="sidebar-nav">
        <div className="nav-section">Engineering</div>
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`nav-link${active ? " active" : ""}`}>
              <span className="hash">#</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
      <div className="sidebar-foot" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        <div className="nav-section" style={{ padding: "0 0 2px" }}>
          View as <span className="muted">· {current.hint}</span>
        </div>
        <div className="role-switch">
          {ROLES.map((r) => (
            <button
              key={r.value}
              className={`role-btn${role === r.value ? " active" : ""}`}
              onClick={() => setRole(r.value)}
              title={r.hint}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
