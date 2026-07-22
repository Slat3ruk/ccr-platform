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
import { comparePatch, newestPatchIn, normalizeSheetPatchLabel, patchChangeKind, shouldDrawLineByDefault } from "@/lib/patch";
import { useRole } from "@/lib/role";
import type { Car, CarCategory, Era, Track, WeightsConfig } from "@/types";
import { CAR_CATEGORIES } from "@/types";

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
  // Team Managers get the panel for reference-data work (tracks, wet penalty)
  // but NOT the cards that rescore or destroy: era lines, webhooks, purge.
  const canManage = role === "admin" || role === "manager";

  const [eras, setEras] = useState<Era[]>([]);
  const [weights, setWeights] = useState<WeightsConfig | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [backend, setBackend] = useState("…");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // current patch + "set patch" form
  const [currentPatch, setCurrentPatch] = useState<string | null>(null);
  const [sheetPatch, setSheetPatch] = useState<string | null>(null); // newest patch label on the synced benchmark sheet
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
  const [tracks, setTracks] = useState<Track[]>([]);
  const [wetSaving, setWetSaving] = useState(false);

  // Track reference data (manager/admin) — add a circuit/layout, or backfill a
  // lap distance the benchmark sync couldn't know.
  const [newTrack, setNewTrack] = useState({ name: "", country: "", length_km: "" });
  const [trackBusy, setTrackBusy] = useState(false);
  const [editTrackId, setEditTrackId] = useState<number | null>(null);
  const [editTrack, setEditTrack] = useState({ name: "", country: "", length_km: "" });

  // Car reference data (manager/admin) — LMU adds cars like it adds tracks.
  const [cars, setCars] = useState<Car[]>([]);
  const [newCar, setNewCar] = useState<{ name: string; category: CarCategory }>({ name: "", category: "Hypercar" });
  const [carBusy, setCarBusy] = useState(false);
  const [editCarId, setEditCarId] = useState<number | null>(null);
  const [editCar, setEditCar] = useState<{ name: string; category: CarCategory }>({ name: "", category: "Hypercar" });

  // Discord webhooks — three channel slots (race / test / board)
  const emptySlot = { configured: false, hint: null as string | null };
  const [hooks, setHooks] = useState<Record<WebhookChannelName, { configured: boolean; hint: string | null }>>({
    race: emptySlot,
    test: emptySlot,
    board: emptySlot,
  });
  const [hookUrls, setHookUrls] = useState<Record<WebhookChannelName, string>>({ race: "", test: "", board: "" });
  const [hookBusy, setHookBusy] = useState<WebhookChannelName | null>(null);
  const [silenced, setSilenced] = useState(false);
  const [silenceBusy, setSilenceBusy] = useState(false);

  const load = useCallback(async () => {
    const [e, w, status, wet, hook, patch, tk, bm, cr] = await Promise.all([
      api.eras(),
      api.weights().catch(() => null),
      api.status(),
      api.wetPenalty().catch(() => null),
      api.webhook().catch(() => null),
      api.patch().catch(() => null),
      api.tracks().catch(() => [] as Track[]),
      api.benchmarks().catch(() => []),
      api.cars().catch(() => [] as Car[]),
    ]);
    setEras(e);
    if (w) setWeights(w.active);
    setCounts(status.counts);
    setBackend(status.backend);
    if (wet) {
      setWetPct(String(wet.penalty_pct));
      setWetOverrides(Object.fromEntries(Object.entries(wet.overrides).map(([id, p]) => [Number(id), String(p)])));
    }
    if (hook) {
      setHooks(hook);
      setSilenced(hook.silenced);
    }
    if (patch) setCurrentPatch(patch.current_patch);
    setSheetPatch(newestPatchIn(bm.map((b) => normalizeSheetPatchLabel(b.patch_version))));
    setTracks(tk);
    setCars(cr);
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

  // Sheet-patch nudge (admin-only by construction — this whole page is): the Ohne
  // Speed benchmark sheet carries a patch label per row; when its newest label is
  // NEWER than the app's current patch, LMU has probably updated and we prompt.
  const sheetIsNewer = sheetPatch != null && (currentPatch == null || comparePatch(sheetPatch, currentPatch) === 1);

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

  // ---- Tracks (manager/admin) ----------------------------------------------
  async function addTrack(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const name = newTrack.name.trim();
    if (!name) {
      setMsg({ kind: "error", text: "Give the track a name." });
      return;
    }
    setTrackBusy(true);
    try {
      const created = await api.createTrack({
        name,
        country: newTrack.country.trim() || null,
        length_km: newTrack.length_km.trim() ? Number(newTrack.length_km) : null,
      });
      setTracks((ts) => [...ts, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTrack({ name: "", country: "", length_km: "" });
      setMsg({ kind: "success", text: `Added “${created.name}”. It's now selectable on the log form.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Couldn't add that track." });
    } finally {
      setTrackBusy(false);
    }
  }

  async function backfillKm() {
    setMsg(null);
    setTrackBusy(true);
    try {
      const res = await api.backfillTrackKm();
      setTracks(await api.tracks());
      setMsg({ kind: "success", text: res.message });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Couldn't fill distances." });
    } finally {
      setTrackBusy(false);
    }
  }

  function startEditTrack(t: Track) {
    setEditTrackId(t.id);
    setEditTrack({
      name: t.name,
      country: t.country ?? "",
      length_km: t.length_km == null ? "" : String(t.length_km),
    });
  }

  async function saveTrack(id: number) {
    setMsg(null);
    setTrackBusy(true);
    try {
      const { track } = await api.updateTrack(id, {
        name: editTrack.name.trim(),
        country: editTrack.country.trim() || null,
        length_km: editTrack.length_km.trim() ? Number(editTrack.length_km) : null,
      });
      setTracks((ts) => ts.map((t) => (t.id === id ? track : t)).sort((a, b) => a.name.localeCompare(b.name)));
      setEditTrackId(null);
      setMsg({ kind: "success", text: `Saved “${track.name}”.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Couldn't save that track." });
    } finally {
      setTrackBusy(false);
    }
  }

  async function removeTrack(t: Track) {
    setMsg(null);
    if (!confirm(`Delete “${t.name}”?\n\nOnly possible while nothing references it — if anything has been logged against it you'll get an explanation instead.`))
      return;
    setTrackBusy(true);
    try {
      await api.deleteTrack(t.id);
      setTracks((ts) => ts.filter((x) => x.id !== t.id));
      setMsg({ kind: "success", text: `Deleted “${t.name}”.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Couldn't delete that track." });
    } finally {
      setTrackBusy(false);
    }
  }

  // ---- Cars (manager/admin) ------------------------------------------------
  async function addCar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const name = newCar.name.trim();
    if (!name) {
      setMsg({ kind: "error", text: "Give the car a name." });
      return;
    }
    setCarBusy(true);
    try {
      const created = await api.createCar({ name, category: newCar.category });
      setCars((cs) => [...cs, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewCar({ name: "", category: newCar.category });
      setMsg({ kind: "success", text: `Added “${created.name}”. It's now selectable on the log form.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Couldn't add that car." });
    } finally {
      setCarBusy(false);
    }
  }

  async function saveCar(id: number) {
    setMsg(null);
    setCarBusy(true);
    try {
      const { car } = await api.updateCar(id, { name: editCar.name.trim(), category: editCar.category });
      setCars((cs) => cs.map((c) => (c.id === id ? car : c)).sort((a, b) => a.name.localeCompare(b.name)));
      setEditCarId(null);
      setMsg({ kind: "success", text: `Saved “${car.name}”.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Couldn't save that car." });
    } finally {
      setCarBusy(false);
    }
  }

  async function removeCar(c: Car) {
    setMsg(null);
    if (!confirm(`Delete “${c.name}”?\n\nOnly possible while nothing references it — if anything has been logged against it you'll get an explanation instead.`))
      return;
    setCarBusy(true);
    try {
      await api.deleteCar(c.id);
      setCars((cs) => cs.filter((x) => x.id !== c.id));
      setMsg({ kind: "success", text: `Deleted “${c.name}”.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Couldn't delete that car." });
    } finally {
      setCarBusy(false);
    }
  }

  async function toggleSilence() {
    setMsg(null);
    setSilenceBusy(true);
    const next = !silenced;
    try {
      await api.setWebhookSilence(next);
      setSilenced(next);
      setMsg({
        kind: "success",
        text: next
          ? "Webhooks silenced — nothing will post to Discord until you resume. Nothing that happens while silenced gets sent later."
          : "Webhooks resumed — new events will post again from now on.",
      });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Failed to update silence mode." });
    } finally {
      setSilenceBusy(false);
    }
  }

  if (!canManage) {
    return (
      <>
        <div className="topbar">
          <span className="hash">#</span>
          <h1>control-panel</h1>
        </div>
        <div className="content">
          <div className="empty">
            <div className="big">🔒</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Team Managers &amp; Admins only</div>
            <div>Your Discord roles don&rsquo;t grant access here — ask a team admin if you need it.</div>
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

            {/* ---- Set current patch (ADMIN: draws era lines = rescores) ---- */}
            {isAdmin && (
            <div className="card">
              <h2>Current patch</h2>
              <div className="card-sub">
                The LMU build the app is on (<code>version.update.patch.hotfix</code>, e.g. <code>1.3.3.4</code> = Update
                3, Patch 3, Hotfix 4 — matches Steam’s patch titles). It’s stamped onto every new session and shown
                across the app. A <strong>version</strong>, <strong>update</strong>, or <strong>patch</strong> bump
                usually resets data comparability (draws a line — older data drops off the live board); a{" "}
                <strong>hotfix</strong> usually doesn’t. We default the toggle for you; override if you know better.
              </div>
              {sheetIsNewer && (
                <div
                  className="lap-parse"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    color: "var(--yellow)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    padding: "8px 12px",
                    marginBottom: 12,
                  }}
                >
                  <span>
                    📄 The Ohne Speed benchmark sheet is labelled <strong>{sheetPatch}</strong>
                    {currentPatch ? (
                      <> — newer than the app’s <strong>{currentPatch}</strong>. LMU has probably updated.</>
                    ) : (
                      <> but no current patch is set here yet.</>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPatchDraft(sheetPatch!);
                      setDrawOverride(null); // follow the smart default for this bump
                    }}
                  >
                    Use {sheetPatch}
                  </button>
                </div>
              )}
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
            )}

            {/* ---- Data export (manager + admin) ---- */}
            <div className="card">
              <h2>Export</h2>
              <div className="card-sub">
                Every logged session as a CSV — driver, car, track, times, tyres, fuel/VE, SVS and comments. Opens
                straight in Excel or Sheets. This is a <strong>readable archive, not the backup of record</strong>: the
                nightly database dump on the server is what an actual restore uses.
              </div>
              <a className="btn" href="/api/sessions/export" download>
                Download sessions CSV
              </a>
            </div>

            {/* ---- Cars (manager + admin) ---- */}
            <div className="card">
              <h2>Cars</h2>
              <div className="card-sub">
                The roster every ranking board is keyed to. Add LMU&rsquo;s new cars here as they land. Deleting only
                works while nothing has been logged against a car — once it&rsquo;s in use, rename it instead.
              </div>

              <form className="flex" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }} onSubmit={addCar}>
                <input
                  type="text"
                  style={{ flex: "2 1 220px" }}
                  placeholder="Car name, e.g. Ferrari 499P"
                  value={newCar.name}
                  onChange={(e) => setNewCar((c) => ({ ...c, name: e.target.value }))}
                />
                <select
                  style={{ flex: "0 1 140px" }}
                  value={newCar.category}
                  onChange={(e) => setNewCar((c) => ({ ...c, category: e.target.value as CarCategory }))}
                >
                  {CAR_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button className="btn" type="submit" disabled={carBusy}>
                  {carBusy ? "Saving…" : "Add car"}
                </button>
              </form>

              <div className="nav-section" style={{ padding: "6px 0 4px" }}>
                {cars.length} car{cars.length === 1 ? "" : "s"}
              </div>

              <div className="cp-track-list">
                {cars.map((c) =>
                  editCarId === c.id ? (
                    <div key={c.id} className="flex" style={{ gap: 6, flexWrap: "wrap", padding: "4px 0" }}>
                      <input
                        type="text"
                        style={{ flex: "2 1 200px" }}
                        value={editCar.name}
                        onChange={(e) => setEditCar((s) => ({ ...s, name: e.target.value }))}
                      />
                      <select
                        style={{ flex: "0 1 130px" }}
                        value={editCar.category}
                        onChange={(e) => setEditCar((s) => ({ ...s, category: e.target.value as CarCategory }))}
                      >
                        {CAR_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <button className="btn btn-sm" onClick={() => saveCar(c.id)} disabled={carBusy}>
                        {carBusy ? "Saving…" : "Save"}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditCarId(null)} disabled={carBusy}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div
                      key={c.id}
                      className="flex"
                      style={{ gap: 8, alignItems: "center", padding: "4px 0", justifyContent: "space-between" }}
                    >
                      <div>
                        {c.name} <span className="hint">{c.category}</span>
                      </div>
                      <div className="flex" style={{ gap: 4 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setEditCarId(c.id);
                            setEditCar({ name: c.name, category: c.category });
                          }}
                          disabled={carBusy}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeCar(c)}
                          disabled={carBusy}
                          title="Only works while nothing has been logged against this car"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>

            {/* ---- Tracks & layouts (manager + admin) ---- */}
            <div className="card">
              <h2>Tracks &amp; layouts</h2>
              <div className="card-sub">
                Every layout is its own track — name it the way the benchmark sheet does (e.g.{" "}
                <code>Silverstone (GP)</code> vs <code>Silverstone (International)</code>) so sync matches it instead of
                creating a duplicate. Lap distance is optional and used for strategy/fuel work, not scoring.
                <br />
                <strong>Adding a track before the sheet has it?</strong> Match the sheet&rsquo;s <em>words</em> and the
                next sync adopts your entry — sessions and all. Capitals, spaces and brackets are ignored when matching,
                so <code>bahrain wec</code> and <code>Bahrain (WEC)</code> are the same track. Delete only works while
                nothing has been logged against a track; once it&rsquo;s in use, rename it instead.
              </div>

              <form className="flex" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }} onSubmit={addTrack}>
                <input
                  type="text"
                  style={{ flex: "2 1 200px" }}
                  placeholder="Track + layout, e.g. Imola"
                  value={newTrack.name}
                  onChange={(e) => setNewTrack((t) => ({ ...t, name: e.target.value }))}
                />
                <input
                  type="text"
                  style={{ flex: "1 1 110px" }}
                  placeholder="Country"
                  value={newTrack.country}
                  onChange={(e) => setNewTrack((t) => ({ ...t, country: e.target.value }))}
                />
                <input
                  type="number"
                  min={0}
                  max={30}
                  step="0.001"
                  inputMode="decimal"
                  style={{ flex: "0 1 110px" }}
                  placeholder="km"
                  value={newTrack.length_km}
                  onChange={(e) => setNewTrack((t) => ({ ...t, length_km: e.target.value }))}
                />
                <button className="btn" type="submit" disabled={trackBusy}>
                  {trackBusy ? "Saving…" : "Add track"}
                </button>
              </form>

              <div
                className="flex"
                style={{ justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 0 4px" }}
              >
                <div className="nav-section" style={{ padding: 0 }}>
                  {tracks.length} track{tracks.length === 1 ? "" : "s"} ·{" "}
                  {tracks.filter((t) => t.length_km == null).length} without a distance
                </div>
                {tracks.some((t) => t.length_km == null) && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={backfillKm}
                    disabled={trackBusy}
                    title="Fills the base circuits we have verified figures for. Never overwrites an existing value."
                  >
                    {trackBusy ? "Filling…" : "Fill known distances"}
                  </button>
                )}
              </div>

              <div className="cp-track-list">
                {tracks.map((t) =>
                  editTrackId === t.id ? (
                    <div key={t.id} className="flex" style={{ gap: 6, flexWrap: "wrap", padding: "4px 0" }}>
                      <input
                        type="text"
                        style={{ flex: "2 1 180px" }}
                        value={editTrack.name}
                        onChange={(e) => setEditTrack((s) => ({ ...s, name: e.target.value }))}
                      />
                      <input
                        type="text"
                        style={{ flex: "1 1 100px" }}
                        placeholder="Country"
                        value={editTrack.country}
                        onChange={(e) => setEditTrack((s) => ({ ...s, country: e.target.value }))}
                      />
                      <input
                        type="number"
                        min={0}
                        max={30}
                        step="0.001"
                        inputMode="decimal"
                        style={{ flex: "0 1 90px" }}
                        placeholder="km"
                        value={editTrack.length_km}
                        onChange={(e) => setEditTrack((s) => ({ ...s, length_km: e.target.value }))}
                      />
                      <button className="btn btn-sm" onClick={() => saveTrack(t.id)} disabled={trackBusy}>
                        {trackBusy ? "Saving…" : "Save"}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditTrackId(null)} disabled={trackBusy}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div
                      key={t.id}
                      className="flex"
                      style={{ gap: 8, alignItems: "center", padding: "4px 0", justifyContent: "space-between" }}
                    >
                      <div>
                        {t.name}
                        {t.country && <span className="muted"> · {t.country}</span>}{" "}
                        {t.length_km != null ? (
                          <span className="hint">{t.length_km} km</span>
                        ) : (
                          <span className="hint" style={{ color: "var(--yellow)" }}>
                            no distance
                          </span>
                        )}
                      </div>
                      <div className="flex" style={{ gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => startEditTrack(t)} disabled={trackBusy}>
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeTrack(t)}
                          disabled={trackBusy}
                          title="Only works while nothing has been logged against this track"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
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

            {/* ---- ADMIN ONLY from here: era undo, webhooks, purge ---- */}
            {isAdmin && (
            <>
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

              <div className={`hook-silence${silenced ? " on" : ""}`}>
                <div>
                  <div className="hook-silence-title">
                    {silenced ? "🔇 Webhooks silenced" : "🔊 Webhooks live"}
                  </div>
                  <div className="hook-silence-sub">
                    {silenced
                      ? "All 3 channels are muted — nothing is posting right now. Data entered while silenced won’t be posted retroactively when you resume."
                      : "Mute all 3 channels at once (e.g. while testing) — resuming only sends new events from that point on, nothing that happened while silenced gets backfilled."}
                  </div>
                </div>
                <button
                  className={`btn btn-sm${silenced ? "" : " btn-ghost"}`}
                  type="button"
                  disabled={silenceBusy}
                  onClick={toggleSilence}
                >
                  {silenceBusy ? "Working…" : silenced ? "Resume" : "Silence"}
                </button>
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
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={busy || silenced}
                          title={silenced ? "Resume webhooks first to send a test message." : undefined}
                          onClick={() => testHook(slot.channel)}
                        >
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
          </>
        )}
      </div>
    </>
  );
}
