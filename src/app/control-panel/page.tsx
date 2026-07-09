"use client";

// ============================================================================
// Admin control panel — functional home for era management, the data purge,
// recompute, and a live status readout. Deliberately plain for now: this page
// is slated to be dressed as the GT3 steering-wheel overlay
// (public/steering-wheel-logo.png) once the features are proven.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type WebhookChannelName } from "@/lib/api-client";
import { currentEra, sortEras } from "@/lib/eras";
import { patchChangeKind, shouldDrawLineByDefault } from "@/lib/patch";
import { useRole } from "@/lib/role";
import type { Era, WeightsConfig } from "@/types";

/** The three webhook slots and what routes to each (mirrors lib/discord.ts). */
const WEBHOOK_SLOTS: { channel: WebhookChannelName; label: string; channelHint: string; events: string }[] = [
  {
    channel: "race",
    label: "Race announcements",
    channelHint: "#race-announcements",
    events: "new eras · #1 takeovers on tracks with an upcoming race",
  },
  {
    channel: "test",
    label: "Test drivers",
    channelHint: "#testdrivers",
    events: "session logged · first data for a combo · all other #1 takeovers · new tracks from a sync",
  },
  {
    channel: "board",
    label: "Leader board",
    channelHint: "#leader-board",
    events: "driver-board badge & crown takeovers (announcer coming next)",
  },
];

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

  // current patch + "set patch" form
  const [currentPatch, setCurrentPatch] = useState<string | null>(null);
  const [patchDraft, setPatchDraft] = useState("");
  const [patchReason, setPatchReason] = useState("");
  const [drawOverride, setDrawOverride] = useState<boolean | null>(null); // null = follow the smart default
  const [patchBusy, setPatchBusy] = useState(false);

  // purge confirmation
  const [purgeText, setPurgeText] = useState("");
  const [purging, setPurging] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  // wet benchmark penalty (global %) + per-track overrides ({ track_id: pctString })
  const [wetPct, setWetPct] = useState("");
  const [wetOverrides, setWetOverrides] = useState<Record<number, string>>({});
  const [addWetTrack, setAddWetTrack] = useState("");
  const [addWetPct, setAddWetPct] = useState("");
  const [tracks, setTracks] = useState<{ id: number; name: string }[]>([]);
  const [wetSaving, setWetSaving] = useState(false);

  // Discord webhooks — three channel slots (race / test / board)
  const emptySlot = { configured: false, hint: null as string | null };
  const [hooks, setHooks] = useState<Record<WebhookChannelName, { configured: boolean; hint: string | null }>>({
    race: emptySlot,
    test: emptySlot,
    board: emptySlot,
  });
  const [hookUrls, setHookUrls] = useState<Record<WebhookChannelName, string>>({ race: "", test: "", board: "" });
  const [hookBusy, setHookBusy] = useState<WebhookChannelName | null>(null);

  const load = useCallback(async () => {
    const [e, w, status, wet, hook, patch, tk] = await Promise.all([
      api.eras(),
      api.weights().catch(() => null),
      api.status(),
      api.wetPenalty().catch(() => null),
      api.webhook().catch(() => null),
      api.patch().catch(() => null),
      api.tracks().catch(() => [] as { id: number; name: string }[]),
    ]);
    setEras(e);
    if (w) setWeights(w.active);
    setCounts(status.counts);
    setBackend(status.backend);
    if (wet) {
      setWetPct(String(wet.penalty_pct));
      setWetOverrides(Object.fromEntries(Object.entries(wet.overrides).map(([id, p]) => [Number(id), String(p)])));
    }
    if (hook) setHooks(hook);
    if (patch) setCurrentPatch(patch.current_patch);
    setTracks(tk);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const nowMs = Date.now();
  const active = useMemo(() => currentEra(eras, nowMs), [eras, nowMs]);
  const history = useMemo(() => sortEras(eras).reverse(), [eras]);

  // Smart default: a version/update/patch bump draws a line; a hotfix just relabels.
  // `drawOverride` lets the admin override; null = follow the suggestion.
  const changeKind = patchChangeKind(currentPatch, patchDraft);
  const suggestDrawLine = shouldDrawLineByDefault(currentPatch, patchDraft);
  const drawLine = drawOverride ?? suggestDrawLine;

  async function savePatch(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const version = patchDraft.trim();
    if (!version) {
      setMsg({ kind: "error", text: "Enter the version, e.g. 1.3.3.4." });
      return;
    }
    setPatchBusy(true);
    try {
      const res = await api.setPatch({ version, draw_line: drawLine, reason: patchReason.trim() || null });
      setPatchDraft("");
      setPatchReason("");
      setDrawOverride(null);
      await load();
      setMsg({
        kind: "success",
        text: res.drew_line
          ? `Now on ${version} — a comparability line was drawn, so the live board scores only sessions from here on. Older data stays viewable from the patch selector. Drawn by mistake? Undo it in “Patch history” below — sessions merge straight back.`
          : `Now on ${version} — label updated and stamped onto new sessions. Existing data kept (no line drawn).`,
      });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to set the patch." });
    } finally {
      setPatchBusy(false);
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

  function addWetOverride() {
    const id = Number(addWetTrack);
    const pct = Number(addWetPct);
    if (!Number.isInteger(id) || id <= 0) {
      setMsg({ kind: "error", text: "Pick a track to override." });
      return;
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
      setMsg({ kind: "error", text: "Override % must be between 0 and 30." });
      return;
    }
    setWetOverrides((o) => ({ ...o, [id]: String(pct) }));
    setAddWetTrack("");
    setAddWetPct("");
  }

  function removeWetOverride(id: number) {
    setWetOverrides((o) => {
      const next = { ...o };
      delete next[id];
      return next;
    });
  }

  async function saveWetPenalty(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const pct = Number(wetPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 30) {
      setMsg({ kind: "error", text: "Wet penalty must be a number between 0 and 30 (%)." });
      return;
    }
    // Build a clean numeric override map (drop blanks/junk).
    const overrides: Record<string, number> = {};
    for (const [id, p] of Object.entries(wetOverrides)) {
      const v = Number(p);
      if (String(p).trim() !== "" && Number.isFinite(v) && v >= 0 && v <= 30) overrides[id] = v;
    }
    setWetSaving(true);
    try {
      const res = await api.setWetPenalty({ penalty_pct: pct, overrides });
      await load();
      const nOv = Object.keys(res.overrides).length;
      setMsg({
        kind: "success",
        text: `Wet penalty set to +${res.penalty_pct}%${nOv ? ` (${nOv} per-track override${nOv === 1 ? "" : "s"})` : ""} — regenerated ${res.derived} wet benchmark rows from the dry sheets.`,
      });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to update wet penalty." });
    } finally {
      setWetSaving(false);
    }
  }

  async function saveHook(channel: WebhookChannelName) {
    setMsg(null);
    setHookBusy(channel);
    try {
      const res = await api.saveWebhook(channel, hookUrls[channel].trim());
      setHookUrls((u) => ({ ...u, [channel]: "" }));
      await load();
      setMsg({
        kind: "success",
        text: res.configured
          ? "Webhook saved — use “Test” to confirm it lands in the right channel."
          : "Webhook cleared for this slot.",
      });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to save webhook." });
    } finally {
      setHookBusy(null);
    }
  }

  async function testHook(channel: WebhookChannelName) {
    setMsg(null);
    setHookBusy(channel);
    try {
      await api.testWebhook(channel);
      setMsg({ kind: "success", text: "Test sent — the message names its feed, so check it landed in the right channel." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setHookBusy(null);
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
                  <div className="k">Current patch</div>
                  <div className="v">{currentPatch ?? "—"}</div>
                  <div className="s">
                    {active ? `last line: ${active.name} · ${fmtWhen(active.starts_at)}` : "no line drawn yet"}
                  </div>
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

            {/* ---- Set current patch ---- */}
            <div className="card">
              <h2>Current patch</h2>
              <div className="card-sub">
                The LMU build the app is on (<code>version.update.patch.hotfix</code>, e.g. <code>1.3.3.4</code> = Update
                3, Patch 3, Hotfix 4 — matches Steam’s patch titles). It’s stamped onto every new session and shown
                across the app. A <strong>version</strong>, <strong>update</strong>, or <strong>patch</strong> bump
                usually resets data comparability (draws a line — older data drops off the live board); a{" "}
                <strong>hotfix</strong> usually doesn’t. We default the toggle for you; override if you know better.
              </div>
              <form onSubmit={savePatch}>
                <div className="row">
                  <div className="field" style={{ maxWidth: 200, flex: "0 0 auto" }}>
                    <label>New version</label>
                    <input
                      type="text"
                      value={patchDraft}
                      placeholder={currentPatch ? `now on ${currentPatch}` : "e.g. 1.3.3.4"}
                      onChange={(e) => {
                        setPatchDraft(e.target.value);
                        setDrawOverride(null); // re-follow the smart default as they retype
                      }}
                    />
                  </div>
                  {drawLine && (
                    <div className="field">
                      <label>
                        Reason <span className="hint">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={patchReason}
                        placeholder="e.g. BoP shakeup — GT3 times reset"
                        onChange={(e) => setPatchReason(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                {patchDraft.trim() && changeKind !== "same" && (
                  <label className="cp-check">
                    <input type="checkbox" checked={drawLine} onChange={(e) => setDrawOverride(e.target.checked)} />
                    <span>
                      Draw a comparability line <span className="muted">— older data drops off the live board</span>
                      <span className="hint" style={{ display: "block" }}>
                        {changeKind === "hotfix"
                          ? "Detected a hotfix — off by default (keeps existing data)."
                          : changeKind === "unknown"
                            ? "Couldn’t read the version tiers — your call."
                            : `Detected ${changeKind === "update" ? "an" : "a"} ${changeKind} bump — on by default (resets comparability).`}
                      </span>
                    </span>
                  </label>
                )}
                <button className="btn" type="submit" disabled={patchBusy}>
                  {patchBusy ? "Saving…" : drawLine ? "Set patch & draw line" : "Set patch"}
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
                <div className="field" style={{ maxWidth: 200 }}>
                  <label>Global penalty %</label>
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

                {/* Per-track overrides */}
                <div className="nav-section" style={{ padding: "6px 0 4px" }}>Per-track overrides</div>
                <div className="card-sub" style={{ marginBottom: 8 }}>
                  Some circuits lose more in the wet — e.g. Le Mans’s long lap. Override a track’s % here; every other
                  track uses the global.
                </div>
                {Object.keys(wetOverrides).length > 0 && (
                  <div className="wet-ov-list">
                    {Object.entries(wetOverrides).map(([id, p]) => (
                      <div className="wet-ov-row" key={id}>
                        <span className="wet-ov-track">{tracks.find((t) => t.id === Number(id))?.name ?? `Track #${id}`}</span>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          step={0.5}
                          value={p}
                          onChange={(e) => setWetOverrides((o) => ({ ...o, [Number(id)]: e.target.value }))}
                          style={{ maxWidth: 90 }}
                        />
                        <span className="muted">%</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeWetOverride(Number(id))}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex" style={{ gap: 8, alignItems: "flex-end", margin: "8px 0 14px", flexWrap: "wrap" }}>
                  <select value={addWetTrack} onChange={(e) => setAddWetTrack(e.target.value)} style={{ maxWidth: 220 }}>
                    <option value="">Add a track override…</option>
                    {tracks
                      .filter((t) => !(t.id in wetOverrides))
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step={0.5}
                    value={addWetPct}
                    onChange={(e) => setAddWetPct(e.target.value)}
                    placeholder="%"
                    style={{ maxWidth: 90 }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addWetOverride} disabled={!addWetTrack}>
                    Add
                  </button>
                </div>

                <button className="btn" type="submit" disabled={wetSaving}>
                  {wetSaving ? "Regenerating…" : "Save & regenerate wet"}
                </button>
              </form>
            </div>

            {/* ---- Patch history (comparability lines) ---- */}
            <div className="card">
              <h2>Patch history</h2>
              <div className="card-sub">
                {eras.length === 0
                  ? "No patch lines drawn yet — every session counts toward the live board."
                  : "Newest first. Each line is a patch that reset comparability. Deleting one merges its sessions back into the previous patch (fully recallable)."}
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

            {/* ---- Discord announcements (three channel slots) ---- */}
            <div className="card">
              <h2>Discord announcements</h2>
              <div className="card-sub">
                One webhook per channel (Discord → channel settings → Integrations → Webhooks). Each slot below says
                exactly which events route to it; the test message names its feed so you can confirm the URL landed in
                the right channel. A slot left empty falls back to the first configured one — nothing goes missing.
                Routine recomputes that change nothing stay silent.
              </div>
              {WEBHOOK_SLOTS.map((slot) => {
                const st = hooks[slot.channel];
                const draft = hookUrls[slot.channel];
                const busy = hookBusy != null;
                return (
                  <div className="hook-slot" key={slot.channel}>
                    <div className="hook-head">
                      <span className="hook-label">
                        {slot.label} <span className="muted">→ {slot.channelHint}</span>
                      </span>
                      {st.configured ? (
                        <span className="hook-status on" title={st.hint ?? undefined}>● connected</span>
                      ) : (
                        <span className="hook-status">○ not set</span>
                      )}
                    </div>
                    <div className="hook-events">{slot.events}</div>
                    <div className="flex" style={{ gap: 8, flexWrap: "wrap" }}>
                      <input
                        type="text"
                        style={{ flex: 1, minWidth: 240 }}
                        placeholder={st.configured ? "Paste a new URL to replace, or leave blank + Save to disconnect" : "https://discord.com/api/webhooks/…"}
                        value={draft}
                        onChange={(e) => setHookUrls((u) => ({ ...u, [slot.channel]: e.target.value }))}
                      />
                      <button
                        className="btn btn-sm"
                        type="button"
                        disabled={busy || (!draft.trim() && !st.configured)}
                        onClick={() => saveHook(slot.channel)}
                      >
                        {hookBusy === slot.channel ? "Working…" : draft.trim() ? "Save" : st.configured ? "Disconnect" : "Save"}
                      </button>
                      {st.configured && (
                        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => testHook(slot.channel)}>
                          Test
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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
