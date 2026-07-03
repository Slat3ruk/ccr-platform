"use client";

// ============================================================================
// Admin control panel — functional home for era management, the data purge,
// recompute, and a live status readout. Deliberately plain for now: this page
// is slated to be dressed as the GT3 steering-wheel overlay
// (public/steering-wheel-logo.png) once the features are proven.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { currentEra, sortEras } from "@/lib/eras";
import { useRole } from "@/lib/role";
import type { Era, WeightsConfig } from "@/types";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ControlPanelPage() {
  const { role } = useRole();
  const isAdmin = role === "admin";

  const [eras, setEras] = useState<Era[]>([]);
  const [weights, setWeights] = useState<WeightsConfig | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [backend, setBackend] = useState("…");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // new-era form
  const [eraName, setEraName] = useState("");
  const [eraReason, setEraReason] = useState("");
  const [eraStart, setEraStart] = useState(""); // datetime-local; empty = now
  const [busy, setBusy] = useState(false);

  // purge confirmation
  const [purgeText, setPurgeText] = useState("");
  const [purging, setPurging] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    const [e, w, status] = await Promise.all([api.eras(), api.weights().catch(() => null), api.status()]);
    setEras(e);
    if (w) setWeights(w.active);
    setCounts(status.counts);
    setBackend(status.backend);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const nowMs = Date.now();
  const active = useMemo(() => currentEra(eras, nowMs), [eras, nowMs]);
  const history = useMemo(() => sortEras(eras).reverse(), [eras]);

  async function startEra(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!eraName.trim()) {
      setMsg({ kind: "error", text: "Give the era a name (e.g. “Patch 1.4”)." });
      return;
    }
    setBusy(true);
    try {
      await api.createEra({
        name: eraName.trim(),
        reason: eraReason.trim() || null,
        starts_at: eraStart ? new Date(eraStart).toISOString() : undefined,
        created_by: "Admin",
      });
      setEraName("");
      setEraReason("");
      setEraStart("");
      await load();
      setMsg({ kind: "success", text: "New era started — the live board now scores only sessions from this line onward. Older data is preserved and viewable from the rankings era selector." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to create era." });
    } finally {
      setBusy(false);
    }
  }

  async function removeEra(era: Era) {
    if (!confirm(`Undo the “${era.name}” line? Sessions are untouched — they flow back into the previous era, and the board recomputes.`)) return;
    setMsg(null);
    await api.deleteEra(era.id);
    await load();
    setMsg({ kind: "success", text: `Era “${era.name}” removed — its sessions rejoined the previous era.` });
  }

  async function purge() {
    if (purgeText !== "PURGE") return;
    if (!confirm(`Delete ALL ${counts.sessions ?? "?"} logged sessions? Cars, tracks, benchmarks, eras and settings survive. This cannot be undone.`)) return;
    setPurging(true);
    setMsg(null);
    try {
      const res = await api.purgeSessions();
      setPurgeText("");
      await load();
      setMsg({ kind: "success", text: `Fresh start: ${res.sessions_removed} sessions deleted. The board is empty until new sessions are logged.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Purge failed." });
    } finally {
      setPurging(false);
    }
  }

  async function recompute() {
    setRecomputing(true);
    setMsg(null);
    try {
      await api.recompute();
      await load();
      setMsg({ kind: "success", text: "Rankings recomputed." });
    } finally {
      setRecomputing(false);
    }
  }

  if (!isAdmin) {
    return (
      <>
        <div className="topbar">
          <span className="hash">#</span>
          <h1>control-panel</h1>
        </div>
        <div className="content">
          <div className="empty">
            <div className="big">🔒</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Admins only</div>
            <div>Switch the view-as toggle to Admin (sidebar footer) to open the control panel.</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>control-panel</h1>
        <span className="sub">
          era: {active ? active.name : eras.length ? "pre-era data" : "all data (no eras drawn)"} · {backend} store
        </span>
      </div>
      <div className="content content-narrow">
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        {loading ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            {/* ---- Status readout (future wheel-LCD side panel) ---- */}
            <div className="card">
              <h2>Status</h2>
              <div className="card-sub">The live state every recompute runs under.</div>
              <div className="cp-stats">
                <div className="cp-stat">
                  <div className="k">Current era</div>
                  <div className="v">{active ? active.name : "All data"}</div>
                  <div className="s">{active ? `since ${fmtWhen(active.starts_at)}` : "no line drawn yet"}</div>
                </div>
                <div className="cp-stat">
                  <div className="k">Weighting</div>
                  <div className="v">{weights?.preset ?? "Balanced"}</div>
                  <div className="s">set on the rankings toolbar</div>
                </div>
                <div className="cp-stat">
                  <div className="k">Sessions</div>
                  <div className="v">{counts.sessions ?? 0}</div>
                  <div className="s">all eras · nothing auto-deletes</div>
                </div>
                <div className="cp-stat">
                  <div className="k">Rankings</div>
                  <div className="v">{counts.recommendations ?? 0}</div>
                  <div className="s">
                    <button className="btn btn-ghost btn-sm" onClick={recompute} disabled={recomputing}>
                      {recomputing ? "Recomputing…" : "🔧 Recompute"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ---- New era ---- */}
            <div className="card">
              <h2>Draw a line in the sand</h2>
              <div className="card-sub">
                Start a new era when a patch/BoP change makes older data non-comparable. Nothing is deleted — the live
                board simply scores from the line onward, and older eras stay viewable from the rankings era selector.
              </div>
              <form onSubmit={startEra}>
                <div className="row">
                  <div className="field">
                    <label>Era name</label>
                    <input type="text" value={eraName} placeholder="e.g. Patch 1.4" onChange={(e) => setEraName(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>
                      Starts <span className="hint">(blank = now; backdate if the patch already dropped)</span>
                    </label>
                    <input type="datetime-local" value={eraStart} onChange={(e) => setEraStart(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label>
                    Reason <span className="hint">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={eraReason}
                    placeholder="e.g. BoP shakeup — GT3 times reset"
                    onChange={(e) => setEraReason(e.target.value)}
                  />
                </div>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? "Starting…" : "Start new era"}
                </button>
              </form>
            </div>

            {/* ---- Era history ---- */}
            <div className="card">
              <h2>Era history</h2>
              <div className="card-sub">
                {eras.length === 0
                  ? "No eras yet — every session counts toward the live board."
                  : "Newest first. Deleting a line merges its sessions back into the previous era (fully recallable)."}
              </div>
              {history.map((e) => (
                <div className="era-row" key={e.id}>
                  <div className="era-meta">
                    <span className="era-name">
                      {e.name}
                      {active?.id === e.id && <span className="pill" style={{ marginLeft: 8, background: "var(--accent)", color: "#fff" }}>current</span>}
                      {Date.parse(e.starts_at) > nowMs && <span className="pill" style={{ marginLeft: 8 }}>starts {fmtWhen(e.starts_at)}</span>}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      from {fmtWhen(e.starts_at)}
                      {e.reason ? ` · ${e.reason}` : ""}
                    </span>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeEra(e)}>
                    Undo line
                  </button>
                </div>
              ))}
            </div>

            {/* ---- Danger zone ---- */}
            <div className="card danger-zone">
              <h2>Danger zone</h2>
              <div className="card-sub">
                Fresh start: permanently delete <strong>all {counts.sessions ?? 0} logged sessions</strong> (e.g. to clear
                demo/junk data). Cars, tracks, benchmarks, eras and settings survive. For routine “old data” concerns,
                draw an era line instead — it keeps history.
              </div>
              <div className="flex" style={{ gap: 8 }}>
                <input
                  type="text"
                  style={{ maxWidth: 180 }}
                  placeholder="Type PURGE to arm"
                  value={purgeText}
                  onChange={(e) => setPurgeText(e.target.value)}
                />
                <button
                  className="btn"
                  style={{ background: purgeText === "PURGE" ? "var(--red)" : "var(--bg-active)", color: purgeText === "PURGE" ? "#fff" : "var(--text-faint)" }}
                  disabled={purgeText !== "PURGE" || purging}
                  onClick={purge}
                >
                  {purging ? "Purging…" : "Delete all sessions"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
