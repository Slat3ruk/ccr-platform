"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExportButton from "@/components/ExportButton";
import RankingsTable from "@/components/RankingsTable";
import SetupBanner from "@/components/SetupBanner";
import WeightsControl from "@/components/WeightsControl";
import { api } from "@/lib/api-client";
import { currentEra, sortEras } from "@/lib/eras";
import { useRole } from "@/lib/role";
import type { Era, RankingRow, Track, WeightsConfig } from "@/types";

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
  const [eras, setEras] = useState<Era[]>([]);
  /** "" = live board (current era); "pre" or an era id = archived view. */
  const [eraView, setEraView] = useState<string>("");

  const filtersRef = useRef({ trackId, cls, condition, eraView });
  filtersRef.current = { trackId, cls, condition, eraView };
  // Monotonic request id: with the 5s poll running, toggling era/filters can
  // leave two fetches in flight — only the newest may write to `rows`.
  const reqSeq = useRef(0);

  const loadMeta = useCallback(async () => {
    const [status, tk, e] = await Promise.all([api.status(), api.tracks(), api.eras().catch(() => [])]);
    setBackend(status.backend);
    setCarsCount(status.counts.cars ?? 0);
    setTracks(tk);
    setEras(e);
  }, []);

  const loadWeights = useCallback(async () => {
    try {
      setWeights((await api.weights()).active);
    } catch {
      /* ignore */
    }
  }, []);

  const loadRankings = useCallback(async () => {
    const seq = ++reqSeq.current;
    const { trackId, cls, condition, eraView } = filtersRef.current;
    const data = await api.rankings({
      track_id: trackId ? Number(trackId) : undefined,
      class: cls || undefined,
      condition: condition || undefined,
      era_id: eraView === "" ? undefined : eraView === "pre" ? "pre" : Number(eraView),
    });
    if (seq !== reqSeq.current) return; // a newer request superseded this one
    setRows(data);
    setUpdatedAt(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    loadMeta().catch(() => {});
    loadWeights().catch(() => {});
  }, [loadMeta, loadWeights]);

  useEffect(() => {
    loadRankings().catch(() => {});
  }, [loadRankings, trackId, cls, condition, eraView]);

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

  const activeEra = useMemo(() => currentEra(eras, Date.now()), [eras]);
  const viewingArchived = eraView !== "";
  const archivedLabel =
    eraView === "pre" ? "pre-era data" : eras.find((e) => String(e.id) === eraView)?.name ?? "archived era";

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>rankings</h1>
        <span className="sub">
          {backend} store · {rows.length} cars
          {activeEra && !viewingArchived ? ` · era: ${activeEra.name}` : ""}
          {updatedAt ? ` · updated ${updatedAt}` : ""}
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
          {role !== "driver" && eras.length > 0 && (
            <div className="field">
              <label>Era</label>
              <select value={eraView} onChange={(e) => setEraView(e.target.value)}>
                <option value="">Current{activeEra ? ` (${activeEra.name})` : ""}</option>
                {sortEras(eras)
                  .slice()
                  .reverse()
                  .filter((e) => e.id !== activeEra?.id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} (archived)
                    </option>
                  ))}
                <option value="pre">Before first era</option>
              </select>
            </div>
          )}
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

        {viewingArchived && (
          <div className="msg" style={{ background: "rgba(240, 178, 50, 0.10)", border: "1px solid var(--yellow)", color: "#f5d489" }}>
            <strong>Viewing archived era: {archivedLabel}</strong> — scored on demand from that era’s sessions (read-only
            history; the live board isn’t affected).{" "}
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setEraView("")}>
              Back to current
            </button>
          </div>
        )}

        {role === "admin" && (
          <div className="msg" style={{ background: "var(--bg-card-2)", border: "1px solid var(--border-soft)", color: "var(--text-faint)" }}>
            <strong style={{ color: "var(--text-muted)" }}>Admin view</strong> — backend: <code>{backend}</code> · expand a
            row to see per-session Session Value Score components. Driver view hides the factor columns; Team Manager shows
            the full breakdown.
          </div>
        )}

        <RankingsTable rows={rows} role={role} activeWeights={weights?.weights} archived={viewingArchived} />
      </div>
    </>
  );
}
