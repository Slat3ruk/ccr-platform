"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExportButton from "@/components/ExportButton";
import RankingsTable from "@/components/RankingsTable";
import SetupBanner from "@/components/SetupBanner";
import WeightsControl from "@/components/WeightsControl";
import PresetWinners from "@/components/PresetWinners";
import { api } from "@/lib/api-client";
import { currentEra, sortEras } from "@/lib/eras";
import { useRole } from "@/lib/role";
import { WEIGHT_PRESETS, weightedFactorScore } from "@/lib/scoring";
import type { Era, FactorScores, RankingRow, Track, WeightsConfig } from "@/types";

const CLASSES = ["LMGT3", "LMH", "LMP3", "LMP2-ELMS"];
const CONDITIONS = ["Dry", "Wet", "Mixed"];
const POLL_MS = 5000;

/** Pull the five 0–100 factor scores off a ranking row. */
function factorsOf(r: RankingRow): FactorScores {
  return {
    pace: r.pace_factor,
    consistency: r.consistency_factor,
    tyre: r.tyre_factor,
    drivability: r.drivability_factor,
    mistakes: r.mistakes_factor,
  };
}

const LENS_KEY = "ccr-view-lens";

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
  /** Per-viewer weighting "lens": "" = team default (server order); else a preset
   *  name that re-ranks the loaded board CLIENT-SIDE (no recompute, personal). */
  const [lens, setLens] = useState<string>("");

  // Restore this viewer's saved lens (personal, localStorage — becomes profile-backed with auth).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LENS_KEY);
      if (saved && WEIGHT_PRESETS.some((p) => p.name === saved)) setLens(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function changeLens(v: string) {
    setLens(v);
    try {
      localStorage.setItem(LENS_KEY, v);
    } catch {
      /* ignore */
    }
  }

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

  const lensPreset = useMemo(() => WEIGHT_PRESETS.find((p) => p.name === lens) ?? null, [lens]);

  // The board as displayed: team default = server order; a lens re-ranks the
  // loaded rows client-side (re-weighted Car Score, re-sorted) — no server call.
  const displayRows = useMemo(() => {
    if (!lensPreset) return rows;
    return [...rows]
      .map((r) => ({
        ...r,
        car_score: weightedFactorScore(factorsOf(r), lensPreset.weights),
        weights_preset: lensPreset.name,
      }))
      .sort((a, b) => b.car_score - a.car_score || a.car_name.localeCompare(b.car_name));
  }, [rows, lensPreset]);

  // Preset winners: the top car under EACH preset, from the loaded rows. Chips
  // whose winner differs from Balanced are the interesting ones (a car hidden by
  // the default weighting). Scoped to the current track/class/condition filter.
  const presetWinners = useMemo(() => {
    if (rows.length === 0) return [];
    return WEIGHT_PRESETS.map((p) => {
      let top: RankingRow | null = null;
      let topScore = -1;
      for (const r of rows) {
        const s = weightedFactorScore(factorsOf(r), p.weights);
        if (s > topScore) {
          topScore = s;
          top = r;
        }
      }
      return { preset: p.name, car_name: top?.car_name ?? "—", car_id: top?.car_id ?? -1, score: topScore };
    });
  }, [rows]);

  const activeEra = useMemo(() => currentEra(eras, Date.now()), [eras]);
  const viewingArchived = eraView !== "";
  const archivedLabel =
    eraView === "pre" ? "pre-patch data" : eras.find((e) => String(e.id) === eraView)?.name ?? "archived patch";

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>rankings</h1>
        <span className="sub">
          {backend} store · {rows.length} cars
          {activeEra && !viewingArchived ? ` · patch: ${activeEra.name}` : ""}
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
              <label>Patch</label>
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
                <option value="pre">Before first patch</option>
              </select>
            </div>
          )}
          <div className="field" style={{ minWidth: 150 }}>
            <label>My view</label>
            <select
              value={lens}
              title="Re-rank the board under a weighting — personal to you, saved on this device. Doesn't change anyone else's board."
              onChange={(e) => changeLens(e.target.value)}
            >
              <option value="">Team default{weights ? ` · ${weights.preset}` : ""}</option>
              {WEIGHT_PRESETS.map((p) => (
                <option key={p.name} value={p.name} title={p.hint}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {role !== "driver" && (
            <WeightsControl
              role={role}
              active={weights}
              label="Team default"
              onApplied={() => {
                loadWeights();
                loadRankings();
              }}
            />
          )}
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
          <ExportButton rows={displayRows} />
        </div>

        {presetWinners.length > 0 && (
          <PresetWinners winners={presetWinners} lens={lens} onPick={changeLens} />
        )}

        {lens && (
          <div className="lens-note">
            Viewing under your <strong>{lens}</strong> lens — personal to you, saved on this device.{" "}
            <button className="btn btn-ghost btn-sm" onClick={() => changeLens("")}>
              Back to team default
            </button>
          </div>
        )}

        {viewingArchived && (
          <div className="msg" style={{ background: "rgba(240, 178, 50, 0.10)", border: "1px solid var(--yellow)", color: "#f5d489" }}>
            <strong>Viewing archived patch: {archivedLabel}</strong> — scored on demand from that patch’s sessions (read-only
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

        <RankingsTable
          rows={displayRows}
          role={role}
          activeWeights={lensPreset ? lensPreset.weights : weights?.weights}
          archived={viewingArchived}
        />
      </div>
    </>
  );
}
