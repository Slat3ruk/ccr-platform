"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";

interface Props {
  backend: string;
  carsCount: number;
  onSeeded: () => void;
}

export default function SetupBanner({ backend, carsCount, onSeeded }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (carsCount > 0) return null;

  async function seed() {
    setBusy(true);
    setErr(null);
    try {
      await api.seed();
      onSeeded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Seed failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="banner info">
      <div style={{ fontSize: 26 }}>🚦</div>
      <div className="banner-body">
        <div className="banner-title">First run — load the LMU car &amp; track data</div>
        <div className="banner-sub">
          Populates the {backend === "json" ? "local dev store" : "database"} with every LMU car, track, and
          placeholder benchmark tier so you can start logging sessions. Safe to click more than once.
        </div>
        {err && <div className="msg error" style={{ marginTop: 8, marginBottom: 0 }}>{err}</div>}
      </div>
      <button className="btn" onClick={seed} disabled={busy}>
        {busy ? "Loading…" : "Load sample data"}
      </button>
    </div>
  );
}
