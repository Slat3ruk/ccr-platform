"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "rankings", icon: "🏆" },
  { href: "/log", label: "log-session", icon: "📝" },
  { href: "/sessions", label: "session-log", icon: "📋" },
  { href: "/benchmarks", label: "benchmarks", icon: "📊" },
];

export default function Sidebar() {
  const pathname = usePathname();
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
      <div className="sidebar-foot">
        <div className="avatar">CC</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Engineer</div>
          <div className="muted" style={{ fontSize: 11 }}>
            Phase 1 · no auth
          </div>
        </div>
      </div>
    </aside>
  );
}
