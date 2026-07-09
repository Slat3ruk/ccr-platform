"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";

/**
 * Navigation shell: the server rail + channel sidebar, plus the mobile drawer
 * behaviour. On desktop this renders exactly the old layout (the holder is
 * `display: contents`, so the grid sees rail + sidebar as before). On phones
 * (≤720px) the rail hides and the sidebar becomes a slide-in drawer toggled by
 * a floating ☰ button; it closes on navigation or backdrop tap.
 */
export default function NavShell() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever a nav link changes the route.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <nav className="rail" aria-label="Servers">
        <div className="rail-logo" title="Cross Current Racing">
          CC
        </div>
        <div className="rail-divider" />
        <div className="rail-icon" title="LMU Intel">
          🏁
        </div>
      </nav>
      <div className={`side-holder${open ? " open" : ""}`}>
        <Sidebar />
      </div>
      {open && <div className="nav-backdrop" onClick={() => setOpen(false)} />}
      <button
        type="button"
        className="nav-fab"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "✕" : "☰"}
      </button>
    </>
  );
}
