"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api-client";
import { ROLES, useRole } from "@/lib/role";

const SECTIONS: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: "Race weekend",
    items: [
      { href: "/start", label: "start-here" },
      { href: "/briefing", label: "briefing" },
    ],
  },
  {
    title: "Leaderboard",
    items: [{ href: "/drivers", label: "driver-board" }],
  },
  {
    title: "Engineering",
    items: [
      { href: "/", label: "rankings" },
      { href: "/coverage", label: "coverage" },
      { href: "/log", label: "log-session" },
      { href: "/sessions", label: "session-log" },
      { href: "/benchmarks", label: "benchmarks" },
      { href: "/scoring", label: "how-scoring-works" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { role, setRole } = useRole();
  const [patch, setPatch] = useState<string | null>(null);

  // Show the current LMU patch globally; refresh on navigation (cheap) so it
  // updates after an admin sets it in the control panel.
  useEffect(() => {
    api.patch().then((p) => setPatch(p.current_patch)).catch(() => {});
  }, [pathname]);
  const current = ROLES.find((r) => r.value === role) ?? ROLES[1];
  const sections =
    role === "admin"
      ? [...SECTIONS, { title: "Admin", items: [{ href: "/control-panel", label: "control-panel" }] }]
      : SECTIONS;
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        Cross Current Racing
        {patch && <span className="patch-badge" title={`LMU patch ${patch} — set in the control panel`}>{patch}</span>}
      </div>
      <div className="sidebar-nav">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="nav-section">{section.title}</div>
            {section.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={`nav-link${active ? " active" : ""}`}>
                  <span className="hash">#</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
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
