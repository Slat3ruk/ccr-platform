"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ExportButton from "@/components/ExportButton";
import RankingsTable from "@/components/RankingsTable";
import SetupBanner from "@/components/SetupBanner";
import { api } from "@/lib/api-client";
import type { Car, RankingRow, Track } from "@/types";

const CLASSES = ["LMGT3", "LMH", "LMP3", "LMP2-ELMS"];
const CONDITIONS = ["Dry", "Wet", "Mixed"];
const POLL_MS = 5000;

export default function DashboardPage() {
  const [backend, setBackend] = useState("…");
  const [carsCount, setCarsCount] = useState<number | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [rows, setRows] = useState<RankingRow[]>([]);
  const [trackId, setTrackId] = useState<string>("");
  const [cls, setCls] = useState<string>("");
  const [condition, setCondition] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const filtersRef = useRef({ trackId, cls, condition });
  filtersRef.current = { trackId, cls, condition };

  const loadMeta = useCallback(async () => {
    const [status, tk] = await Promise.all([api.status(), api.tracks()]);
    setBackend(status.backend);
    setCarsCount(status.counts.cars ?? 0);
    setTracks(tk);
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
  }, [loadMeta]);

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
          <ExportButton rows={rows} />
        </div>

        <RankingsTable rows={rows} />
      </div>
    </>
  );
}
