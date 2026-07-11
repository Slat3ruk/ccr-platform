"use client";

// ============================================================================
// First-run welcome banner — the friendly "you are here" for new visitors,
// shown once and dismissible forever (remembered per browser). NOT a forced
// interstitial: repeat users who've dismissed it never see it again. Points at
// the /start guide for the full how-to.
// ============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISS_KEY = "ccr-welcome-dismissed";

export default function WelcomeBanner() {
  // Start hidden; reveal only after we've checked localStorage, so it never
  // flashes for someone who already dismissed it.
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== "1") setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — just hide for this session */
    }
    setShow(false);
  };

  return (
    <div
      className="card"
      style={{
        borderColor: "var(--accent)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>👋 Welcome to the Cross Current Racing data platform</div>
        <div className="muted" style={{ fontSize: 13 }}>
          The team's data-driven answer to "which car for this track?" New here? The 3-step guide gets you logging in a
          minute.
        </div>
      </div>
      <Link href="/start" className="btn" style={{ flexShrink: 0 }}>
        Start here →
      </Link>
      <button
        className="btn btn-ghost btn-sm"
        onClick={dismiss}
        aria-label="Dismiss welcome"
        title="Dismiss — won't show again"
        style={{ flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
}
