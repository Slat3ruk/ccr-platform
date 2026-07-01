"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ExportButton from "@/components/ExportButton";
import RankingsTable from "@/components/RankingsTable";
import SetupBanner from "@/components/SetupBanner";
import WeightsControl from "@/components/WeightsControl";
import { api } from "@/lib/api-client";
import { useRole } from "@/lib/role";
import type { RankingRow, Track, WeightsConfig } from "@/types";

const CLASSES = ["LMGT3", "LMH", "LMP3", "LMP2-ELMS"];
const CONDITIONS = ["Dry", "Wet", "Mixed"];
const POLL_MS = 5000;

export default function DashboardPage() {
  const { role } = useRole();
  const [backend, setBackend] = useState("…");
  const [recomputing, setRecomputing] = useState(false);
  const [carsCount, setCarsCount] = useState<number | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [trackId, setTrackId] = useState<string>("");
  const [cls, setCls] = useState<string>("");
  const [condition, setCondition] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [weights, setWeights] = useState<WeightsConfig | null>(null);

  const filtersRef = useRef({ trackId, cls, condition });
  filtersRef.current = { trackId, cls, condition };

  const loadMeta = useCallback(async () => {
    const [status, tk] = await Promise.all([api.status(), api.tracks()]);
    setBackend(status.backend);
    setCarsCount(status.counts.cars ?? 0);
    setTracks(tk);
  }, []);

  const loadWeights = useCallback(async () => {
    try {
      setWeights((await api.weights()).active);
    } catch {
      /* ignore */
    }
  }, []);

  const loadRankings = useCallback(async () => {
    const { trackId, cls, condition } = filtersRef.current;
    const data = await api.rankings({
      track_id: trackId ? Number(trackId) : undefined,
      class: cls || undefined,
      condition: condition || undefined,
    });
    setRows(data);
    setUpdatedAt(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    loadMeta().catch(() => {});
    loadWeights().catch(() => {});
  }, [loadMeta, loadWeights]);

  useEffect(() => {
    loadRankings().catch(() => {});
  }, [loadRankings, trackId, cls, condition]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      loadRankings().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, loadRankings]);

  async function recompute() {
    setRecomputing(true);
    try {
      await api.recompute();
      await loadRankings();
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>rankings</h1>
        <span className="sub">
          {backend} store · {rows.length} cars{updatedAt ? ` · updated ${updatedAt}` : ""}
        </span>
      </div>
      <div className="content">
        {carsCount === 0 && (
          <SetupBanner
            backend={backend}
            carsCount={carsCount}
            onSeeded={() => {
              loadMeta();
              loadRankings();
            }}
          />
        )}

        <div className="toolbar">
          <div className="field">
            <label>Track</label>
            <select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
              <option value="">All tracks</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Class</label>
            <select value={cls} onChange={(e) => setCls(e.target.value)}>
              <option value="">All classes</option>
              {CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Condition</label>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">All</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <WeightsControl
            role={role}
            active={weights}
            onApplied={() => {
              loadWeights();
              loadRankings();
            }}
          />
          <div className="spacer" />
          <div className="field" style={{ minWidth: 0 }}>
            <label>Auto-refresh</label>
            <label className="flex" style={{ gap: 6, fontWeight: 500, textTransform: "none" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <span className="muted" style={{ fontSize: 13 }}>5s</span>
            </label>
          </div>
          {role === "admin" && (
            <button className="btn btn-ghost btn-sm" onClick={recompute} disabled={recomputing}>
              {recomputing ? "Recomputing…" : "🔧 Recompute"}
            </button>
          )}
          <ExportButton rows={rows} />
        </div>

        {role === "admin" && (
          <div className="msg" style={{ background: "var(--bg-card-2)", border: "1px solid var(--border-soft)", color: "var(--text-faint)" }}>
            <strong style={{ color: "var(--text-muted)" }}>Admin view</strong> — backend: <code>{backend}</code> · expand a
            row to see per-session Session Value Score components. Driver view hides the factor columns; Team Manager shows
            the full breakdown.
          </div>
        )}

        <RankingsTable rows={rows} role={role} activeWeights={weights?.weights} />
      </div>
    </>
  );
}
