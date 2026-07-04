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
  const [removingId, setRemovingId] = useState<number | null>(null);

  // wet benchmark penalty
  const [wetPct, setWetPct] = useState("");
  const [wetSaving, setWetSaving] = useState(false);

  // Discord webhook
  const [hookUrl, setHookUrl] = useState("");
  const [hookConfigured, setHookConfigured] = useState(false);
  const [hookHint, setHookHint] = useState<string | null>(null);
  const [hookBusy, setHookBusy] = useState(false);

  const load = useCallback(async () => {
    const [e, w, status, wet, hook] = await Promise.all([
      api.eras(),
      api.weights().catch(() => null),
      api.status(),
      api.wetPenalty().catch(() => null),
      api.webhook().catch(() => null),
    ]);
    setEras(e);
    if (w) setWeights(w.active);
    setCounts(status.counts);
    setBackend(status.backend);
    if (wet) setWetPct(String(wet.penalty_pct));
    if (hook) {
      setHookConfigured(hook.configured);
      setHookHint(hook.hint);
    }
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
    if (removingId != null) return; // guard against a double-click / concurrent delete
    if (!confirm(`Undo the “${era.name}” line? Sessions are untouched — they flow back into the previous era, and the board recomputes.`)) return;
    setMsg(null);
    setRemovingId(era.id);
    try {
      await api.deleteEra(era.id);
      await load();
      setMsg({ kind: "success", text: `Era “${era.name}” removed — its sessions rejoined the previous era.` });
    } catch (err) {
      // e.g. a 404 if it was already deleted in another tab — refresh so the UI reflects reality.
      await load().catch(() => {});
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to remove era." });
    } finally {
      setRemovingId(null);
    }
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

  async function saveWetPenalty(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const pct = Number(wetPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
      setMsg({ kind: "error", text: "Wet penalty must be a number between 0 and 30 (%)." });
      return;
    }
    setWetSaving(true);
    try {
      const res = await api.setWetPenalty(pct);
      await load();
      setMsg({ kind: "success", text: `Wet penalty set to +${res.penalty_pct}% — regenerated ${res.derived} wet benchmark rows from the dry sheets.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to update wet penalty." });
    } finally {
      setWetSaving(false);
    }
  }

  async function saveHook(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setHookBusy(true);
    try {
      const res = await api.saveWebhook(hookUrl.trim());
      setHookUrl("");
      await load();
      setMsg({
        kind: "success",
        text: res.configured
          ? "Webhook saved — use “Send test message” to confirm it lands in the channel."
          : "Webhook cleared — announcements are off.",
      });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to save webhook." });
    } finally {
      setHookBusy(false);
    }
  }

  async function testHook() {
    setMsg(null);
    setHookBusy(true);
    try {
      await api.testWebhook();
      setMsg({ kind: "success", text: "Test message sent — check the Discord channel." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setHookBusy(false);
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

            {/* ---- Wet benchmark penalty ---- */}
            <div className="card">
              <h2>Wet pace penalty</h2>
              <div className="card-sub">
                The Ohne Speed sheet is dry-only. Wet benchmark tiers are <strong>derived</strong> as{" "}
                dry × (1 + penalty). LMU dry→fully-wet loss runs ~5–10% (a 3:30 Le Mans lap ≈ 15–25s).
                Changing this regenerates every wet tier and recomputes wet rankings.
              </div>
              <form onSubmit={saveWetPenalty}>
                <div className="row">
                  <div className="field" style={{ maxWidth: 160, flex: "0 0 auto" }}>
                    <label>Penalty %</label>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      step={0.5}
                      value={wetPct}
                      onChange={(e) => setWetPct(e.target.value)}
                      placeholder="8"
                    />
                  </div>
                  <div className="field" style={{ justifyContent: "flex-end" }}>
                    <button className="btn" type="submit" disabled={wetSaving}>
                      {wetSaving ? "Regenerating…" : "Save & regenerate wet"}
                    </button>
                  </div>
                </div>
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
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeEra(e)}
                    disabled={removingId != null}
                  >
                    {removingId === e.id ? "Removing…" : "Undo line"}
                  </button>
                </div>
              ))}
            </div>

            {/* ---- Discord announcements ---- */}
            <div className="card">
              <h2>Discord announcements</h2>
              <div className="card-sub">
                Paste a channel webhook URL (Discord → channel settings → Integrations → Webhooks) and the platform posts
                on real changes: <strong>#1 takeovers</strong> on any board, a <strong>new era</strong>, and{" "}
                <strong>new tracks</strong> appearing from a benchmark sync. Routine recomputes that change nothing stay
                silent. Status:{" "}
                {hookConfigured ? (
                  <span style={{ color: "var(--green)", fontWeight: 700 }}>connected{hookHint ? ` (${hookHint})` : ""}</span>
                ) : (
                  <span className="muted">not configured</span>
                )}
              </div>
              <form onSubmit={saveHook}>
                <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    style={{ flex: 1, minWidth: 260 }}
                    placeholder={hookConfigured ? "Paste a new URL to replace, or leave blank + Save to disconnect" : "https://discord.com/api/webhooks/…"}
                    value={hookUrl}
                    onChange={(e) => setHookUrl(e.target.value)}
                  />
                  <button className="btn" type="submit" disabled={hookBusy || (!hookUrl.trim() && !hookConfigured)}>
                    {hookBusy ? "Working…" : hookUrl.trim() ? "Save" : hookConfigured ? "Disconnect" : "Save"}
                  </button>
                  {hookConfigured && (
                    <button className="btn btn-ghost" type="button" disabled={hookBusy} onClick={testHook}>
                      Send test message
                    </button>
                  )}
                </div>
              </form>
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
