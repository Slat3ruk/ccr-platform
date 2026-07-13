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
  const { role, name } = useRole();
  const [patch, setPatch] = useState<string | null>(null);
  const [silenced, setSilenced] = useState(false);

  // Show the current LMU patch globally; refresh on navigation (cheap) so it
  // updates after an admin sets it in the control panel.
  useEffect(() => {
    api.patch().then((p) => setPatch(p.current_patch)).catch(() => {});
  }, [pathname]);

  // Admin-only: surface webhook silence state everywhere, not just the control
  // panel, so it's never forgotten mid-testing.
  useEffect(() => {
    if (role !== "admin") return;
    api.webhook().then((h) => setSilenced(h.silenced)).catch(() => {});
  }, [pathname, role]);
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
      {role === "admin" && silenced && (
        <div className="silence-banner" title="All Discord webhooks are muted — resume them in the control panel.">
          🔇 Webhooks silenced
        </div>
      )}
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
      <div className="sidebar-foot">
        <div className="sidebar-identity">
          <div>
            Signed in as <span className="name">{name || "…"}</span>
          </div>
          <div className="role-badge">{current.label}</div>
        </div>
      </div>
    </aside>
  );
}
