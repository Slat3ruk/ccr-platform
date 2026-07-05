"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { countdownLabel, pickFeatured, type RaceWindow } from "@/lib/calendar";
import { confidenceTitle, fmtPct, fmtScore, scoreColor } from "@/lib/format";
import { ROLES, useRole } from "@/lib/role";
import { RACING_CLASSES, type Car, type RaceRow, type RankingRow, type TestRequest, type Track, type WeightsConfig } from "@/types";

function verdict(score: number): string {
  if (score >= 85) return "Top pick";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Viable";
  if (score >= 45) return "Marginal";
  return "Avoid";
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/**
 * When to show for a race. With a `start_at` (absolute UTC instant) we render
 * the full date + time in the VIEWER's local timezone — a UK 19:00 shows as
 * 20:00 CEST to a German driver. Without it, the day only (time TBC).
 */
function fmtRaceWhen(race: { event_date: string; start_at?: string | null }): string {
  if (race.start_at) {
    return new Date(race.start_at).toLocaleString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }
  return fmtDate(race.event_date);
}

/** Short local time for compact spots (e.g. "20:00 CEST"). */
function fmtLocalTime(startAt: string): string {
  return new Date(startAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

export default function BriefingPage() {
  const { role } = useRole();
  const canEdit = role !== "driver";
  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? "Team Manager";

  const [races, setRaces] = useState<RaceRow[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [testReqs, setTestReqs] = useState<TestRequest[]>([]);
  const [rankings, setRankings] = useState<RankingRow[]>([]);
  // Picks for the OTHER classes racing the same weekend (same track + date).
  const [siblingPicks, setSiblingPicks] = useState<{ race: RaceRow; top: RankingRow | null }[]>([]);
  const [weights, setWeights] = useState<WeightsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs] = useState(() => Date.now());

  // note editor
  const [editing, setEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBy, setNoteBy] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // add-race form
  const [formTrack, setFormTrack] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState(""); // optional wall-clock in the manager's local TZ
  const [formClass, setFormClass] = useState("");
  const [formName, setFormName] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formErr, setFormErr] = useState("");

  const loadRaces = useCallback(async () => {
    const r = await api.races();
    setRaces(r);
  }, []);

  const loadTestReqs = useCallback(async () => {
    setTestReqs(await api.testRequests().catch(() => []));
  }, []);

  const loadAll = useCallback(async () => {
    const [r, tk, c, tr, w] = await Promise.all([
      api.races(),
      api.tracks(),
      api.cars().catch(() => [] as Car[]),
      api.testRequests().catch(() => [] as TestRequest[]),
      api.weights().catch(() => null),
    ]);
    setRaces(r);
    setTracks(tk);
    setCars(c);
    setTestReqs(tr);
    if (w) setWeights(w.active);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll().catch(() => setLoading(false));
  }, [loadAll]);

  const result = useMemo(() => pickFeatured(races, nowMs), [races, nowMs]);
  const focus: RaceWindow<RaceRow> | null = result.featured ?? result.next;
  const isFeatured = !!result.featured;

  // Load the ranking for whichever race is in focus (respecting its class/condition).
  useEffect(() => {
    const race = focus?.race;
    if (!race) {
      setRankings([]);
      return;
    }
    api
      .rankings({ track_id: race.track_id, class: race.class ?? undefined, condition: race.condition ?? undefined })
      .then(setRankings)
      .catch(() => setRankings([]));
  }, [focus?.race?.id, focus?.race?.track_id, focus?.race?.class, focus?.race?.condition]);

  // Load the top pick for every OTHER class racing the same weekend — a real
  // endurance event runs several classes at once (GT3 + LMP2 + Hypercar).
  useEffect(() => {
    const race = focus?.race;
    if (!race) {
      setSiblingPicks([]);
      return;
    }
    const siblings = races.filter((r) => r.id !== race.id && r.track_id === race.track_id && r.event_date === race.event_date);
    if (siblings.length === 0) {
      setSiblingPicks([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      siblings.map((r) =>
        api
          .rankings({ track_id: r.track_id, class: r.class ?? undefined, condition: r.condition ?? undefined })
          .then((rows) => ({ race: r, top: rows[0] ?? null }))
          .catch(() => ({ race: r, top: null })),
      ),
    ).then((res) => {
      if (!cancelled) setSiblingPicks(res);
    });
    return () => {
      cancelled = true;
    };
  }, [focus?.race?.id, focus?.race?.track_id, focus?.race?.event_date, races]);

  // Seed the note editor whenever the focused race changes.
  useEffect(() => {
    setNoteDraft(focus?.race.note ?? "");
    setNoteBy(focus?.race.note_by ?? "");
    setEditing(false);
  }, [focus?.race?.id]);

  const topCar = rankings[0] ?? null;

  async function saveNote() {
    if (!focus) return;
    setSavingNote(true);
    try {
      await api.updateRace(focus.race.id, { note: noteDraft, note_by: noteBy || roleLabel });
      await loadRaces();
      setEditing(false);
    } finally {
      setSavingNote(false);
    }
  }

  async function addRace(e: React.FormEvent) {
    e.preventDefault();
    setFormErr("");
    if (!formTrack || !formDate) {
      setFormErr("Pick a track and a date.");
      return;
    }
    setFormBusy(true);
    try {
      // A time is entered as the manager's LOCAL wall-clock; `new Date("YYYY-MM-DDThh:mm")`
      // reads it in this browser's timezone and .toISOString() pins it to an
      // absolute UTC instant, so every viewer sees it in their own local time.
      const start_at = formTime ? new Date(`${formDate}T${formTime}`).toISOString() : null;
      await api.createRace({
        track_id: Number(formTrack),
        event_date: formDate,
        start_at,
        class: formClass ? (formClass as RaceRow["class"]) : null,
        name: formName.trim() || null,
        created_by: roleLabel,
      });
      setFormTrack("");
      setFormDate("");
      setFormTime("");
      setFormClass("");
      setFormName("");
      await loadRaces();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : "Failed to add race.");
    } finally {
      setFormBusy(false);
    }
  }

  async function removeRace(id: number, label: string) {
    if (!confirm(`Remove ${label} from the calendar?`)) return;
    await api.deleteRace(id);
    await loadRaces();
  }

  async function clearRequest(id: number) {
    await api.deleteTestRequest(id).catch(() => {});
    await loadTestReqs();
  }

  // "Testing wanted" list, resolved to names and ordered with combos for tracks
  // that have an upcoming race first (close the race-relevant gaps first).
  const wantedTests = useMemo(() => {
    const carName = new Map(cars.map((c) => [c.id, c.name]));
    const trackName = new Map(tracks.map((t) => [t.id, t.name]));
    const today = new Date().toISOString().slice(0, 10);
    const raceTracks = new Set(races.filter((r) => r.event_date >= today).map((r) => r.track_id));
    return testReqs
      .map((r) => ({
        req: r,
        car: carName.get(r.car_id) ?? `Car #${r.car_id}`,
        track: trackName.get(r.track_id) ?? `Track #${r.track_id}`,
        racing: raceTracks.has(r.track_id),
      }))
      .sort((a, b) => Number(b.racing) - Number(a.racing) || Date.parse(b.req.created_at) - Date.parse(a.req.created_at));
  }, [testReqs, cars, tracks, races]);

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>briefing</h1>
        <span className="sub">Cross Current Racing team has · {races.length} race{races.length === 1 ? "" : "s"} on the calendar</span>
      </div>
      <div className="content">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : !focus ? (
          <div className="empty">
            <div className="big">📣</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>No races on the calendar</div>
            <div>{canEdit ? "Add a race weekend below to generate a briefing." : "Ask a Team Manager to add the next race."}</div>
          </div>
        ) : (
          <>
            {/* ---- BLUF headline card ---- */}
            <div className={`bluf${isFeatured ? " bluf-live" : ""}`}>
              <div className="bluf-eyebrow">
                <span className={`bluf-badge${isFeatured ? " live" : ""}`}>
                  {isFeatured ? "This weekend" : "Coming up"}
                </span>
                <span className="muted">
                  {focus.race.name ? `${focus.race.name} · ` : ""}
                  {fmtRaceWhen(focus.race)} · {countdownLabel(focus.daysUntil)}
                  {focus.race.start_at && <span className="hint"> · your local time</span>}
                </span>
              </div>

              <h2 className="bluf-track">
                {focus.race.track_name}
                {focus.race.class && <span className="pill" style={{ marginLeft: 10 }}>{focus.race.class}</span>}
                {focus.race.condition && (
                  <span className="pill" style={{ marginLeft: 6 }}>{focus.race.condition}</span>
                )}
              </h2>

              {topCar ? (
                <div className="bluf-rec">
                  <div className="bluf-run">
                    <span className="bluf-run-label">Run the</span>
                    <span className="bluf-car">{topCar.car_name}</span>
                    {topCar.weights_preset && (
                      <span className="preset-tag" title={`Ranked using the ${topCar.weights_preset} weighting`}>
                        <span className="tag-dot" />
                        {topCar.weights_preset}
                      </span>
                    )}
                  </div>
                  <div className="bluf-stats">
                    <span className="score-pill" style={{ background: scoreColor(topCar.car_score) }}>
                      {fmtScore(topCar.car_score)}
                    </span>
                    <span className="pill" style={{ background: scoreColor(topCar.car_score), color: "#0c0c0c" }}>
                      {verdict(topCar.car_score)}
                    </span>
                    <span className="muted">
                      {topCar.car_category} ·{" "}
                      <span title={confidenceTitle(topCar.confidence_score, topCar.sessions_used)} style={{ cursor: "help" }}>
                        {fmtPct(topCar.confidence_score)} confidence
                      </span>{" "}
                      · {topCar.sessions_used} session{topCar.sessions_used === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="bluf-alts">
                    {rankings.slice(1, 4).map((r, i) => (
                      <span key={r.id} className="bluf-alt">
                        <span className="muted">{i + 2}.</span> {r.car_name}{" "}
                        <span className="muted">{fmtScore(r.car_score)}</span>
                      </span>
                    ))}
                    {rankings.length === 0 && null}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Mathematically ranked from logged sessions using the{" "}
                    <strong style={{ color: "var(--text-muted)" }}>{weights?.preset ?? topCar.weights_preset ?? "Balanced"}</strong>{" "}
                    weighting.
                  </div>
                </div>
              ) : (
                <div className="bluf-rec">
                  <div className="muted">
                    No ranked cars for this track{focus.race.class ? ` in ${focus.race.class}` : ""} yet — log some sessions
                    on <a href="/log">#log-session</a> and the pick will appear here.
                  </div>
                </div>
              )}

              {/* ---- Other classes racing the same weekend ---- */}
              {siblingPicks.length > 0 && (
                <div className="bluf-siblings">
                  <span className="bluf-sib-label">Also racing this weekend</span>
                  <div className="bluf-sib-list">
                    {siblingPicks.map(({ race, top }) => (
                      <div className="bluf-sib" key={race.id}>
                        <span className="pill">{race.class ?? "Any"}</span>
                        {race.start_at && <span className="bluf-sib-time">{fmtLocalTime(race.start_at)}</span>}
                        {top ? (
                          <>
                            <span className="bluf-sib-car">{top.car_name}</span>
                            <span className="score-pill" style={{ background: scoreColor(top.car_score) }}>
                              {fmtScore(top.car_score)}
                            </span>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {top.sessions_used} session{top.sessions_used === 1 ? "" : "s"}
                            </span>
                          </>
                        ) : (
                          <span className="muted" style={{ fontSize: 13 }}>no ranked car yet — log sessions</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ---- Engineer note ---- */}
              <div className="bluf-note">
                <div className="flex spread" style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: 13 }}>Engineer's note</strong>
                  {canEdit && !editing && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                      {focus.race.note ? "Edit" : "Add note"}
                    </button>
                  )}
                </div>

                {editing ? (
                  <div>
                    <textarea
                      rows={3}
                      value={noteDraft}
                      placeholder="e.g. Run the Ferrari 296 — smooth throttle out of the slow stuff, it protects the rears for a longer final stint."
                      onChange={(e) => setNoteDraft(e.target.value)}
                    />
                    <div className="flex" style={{ gap: 8, marginTop: 8 }}>
                      <input
                        type="text"
                        style={{ maxWidth: 200 }}
                        placeholder={`Posted by (${roleLabel})`}
                        value={noteBy}
                        onChange={(e) => setNoteBy(e.target.value)}
                      />
                      <button className="btn btn-sm" disabled={savingNote} onClick={saveNote}>
                        {savingNote ? "Saving…" : "Post note"}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={savingNote}
                        onClick={() => {
                          setNoteDraft(focus.race.note ?? "");
                          setNoteBy(focus.race.note_by ?? "");
                          setEditing(false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : focus.race.note ? (
                  <div>
                    <div className="bluf-note-body">{focus.race.note}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      — {focus.race.note_by || "Engineer"}
                      {focus.race.note_updated_at ? ` · ${new Date(focus.race.note_updated_at).toLocaleString()}` : ""}
                    </div>
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>No briefing note yet.</div>
                )}
              </div>
            </div>

            {/* ---- Upcoming races (excluding same-weekend siblings, shown above) ---- */}
            {(() => {
              const otherUpcoming = result.upcoming.filter(
                (w) => !(focus && w.race.track_id === focus.race.track_id && w.race.event_date === focus.race.event_date),
              );
              return otherUpcoming.length > 0 ? (
              <div className="card">
                <h2>Upcoming</h2>
                <div className="card-sub">Races further out — the briefing features each one from 3 days before.</div>
                <div className="race-list">
                  {otherUpcoming.map((w) => (
                    <div className="race-row" key={w.race.id}>
                      <div className="race-when">
                        <span className="race-date">{fmtDate(w.race.event_date)}</span>
                        <span className="muted">
                          {w.race.start_at ? fmtLocalTime(w.race.start_at) + " · " : ""}
                          {countdownLabel(w.daysUntil)}
                        </span>
                      </div>
                      <div className="race-meta">
                        <span className="race-track">{w.race.track_name}</span>
                        {w.race.name && <span className="muted"> · {w.race.name}</span>}
                        {w.race.class && <span className="pill" style={{ marginLeft: 8 }}>{w.race.class}</span>}
                      </div>
                      {canEdit && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeRace(w.race.id, w.race.track_name)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              ) : null;
            })()}

            {/* ---- Featured-race remove (managers) ---- */}
            {canEdit && (
              <div className="flex" style={{ gap: 8, marginBottom: 16 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => removeRace(focus.race.id, focus.race.track_name)}>
                  Remove “{focus.race.track_name}” from calendar
                </button>
              </div>
            )}
          </>
        )}

        {/* ---- Testing wanted (from the coverage map) ---- */}
        {wantedTests.length > 0 && (
          <div className="card">
            <h2>📋 Testing wanted</h2>
            <div className="card-sub">
              Flagged from the <a href="/coverage">#coverage</a> map — combos the engine needs data on. Race-week tracks first.
            </div>
            <div className="wanted-list">
              {wantedTests.map(({ req, car, track, racing }) => (
                <div className="wanted-row" key={req.id}>
                  {racing && <span title="This track has an upcoming race">📅</span>}
                  <span className="wanted-combo">
                    <strong>{car}</strong> <span className="muted">@ {track}</span>
                  </span>
                  <span className="pill">{req.condition}</span>
                  {req.note && <span className="muted" style={{ fontSize: 12 }}>{req.note}</span>}
                  {canEdit && (
                    <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => clearRequest(req.id)}>
                      Clear
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- Add race (managers/admins) ---- */}
        {canEdit && (
          <div className="card">
            <h2>Add a race</h2>
            <div className="card-sub">
              Set the main race day (usually Saturday). It becomes the featured briefing from 3 days before, through the day
              after.
            </div>
            {formErr && <div className="msg error">{formErr}</div>}
            <form onSubmit={addRace}>
              <div className="row">
                <div className="field">
                  <label>Track</label>
                  <select value={formTrack} onChange={(e) => setFormTrack(e.target.value)}>
                    <option value="">Select track…</option>
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Race day</label>
                  <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>
                    Start time <span className="hint">optional · your local time</span>
                  </label>
                  <input type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)} />
                </div>
                <div className="field">
                  <label>
                    Class <span className="hint">optional</span>
                  </label>
                  <select value={formClass} onChange={(e) => setFormClass(e.target.value)}>
                    <option value="">Any / top overall</option>
                    {RACING_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>
                    Event name <span className="hint">optional</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    placeholder="e.g. Round 3 — 6h"
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>
              </div>
              <button className="btn" type="submit" disabled={formBusy}>
                {formBusy ? "Adding…" : "Add to calendar"}
              </button>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
