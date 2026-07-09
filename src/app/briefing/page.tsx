"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AccuracyCard from "@/components/AccuracyCard";
import RaceCard from "@/components/RaceCard";
import { api } from "@/lib/api-client";
import { countdownLabel, pickFeatured, type RaceWindow } from "@/lib/calendar";
import { ROLES, useRole } from "@/lib/role";
import { RACING_CLASSES, type Car, type RaceRow, type RankingRow, type TestRequest, type Track, type WeightsConfig } from "@/types";

function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
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
  // Full rankings for the OTHER classes racing the same weekend (same track + date).
  const [siblingRaces, setSiblingRaces] = useState<{ race: RaceRow; rankings: RankingRow[] }[]>([]);
  const [weights, setWeights] = useState<WeightsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowMs] = useState(() => Date.now());

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

  // Load full rankings for every OTHER class racing the same weekend — a real
  // endurance event runs several classes at once (GT3 + LMP2 + Hypercar). Each
  // renders as its own full RaceCard, identical to the featured one.
  useEffect(() => {
    const race = focus?.race;
    if (!race) {
      setSiblingRaces([]);
      return;
    }
    const siblings = races.filter((r) => r.id !== race.id && r.track_id === race.track_id && r.event_date === race.event_date);
    if (siblings.length === 0) {
      setSiblingRaces([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      siblings.map((r) =>
        api
          .rankings({ track_id: r.track_id, class: r.class ?? undefined, condition: r.condition ?? undefined })
          .then((rows) => ({ race: r, rankings: rows }))
          .catch(() => ({ race: r, rankings: [] as RankingRow[] })),
      ),
    ).then((res) => {
      if (!cancelled) setSiblingRaces(res);
    });
    return () => {
      cancelled = true;
    };
  }, [focus?.race?.id, focus?.race?.track_id, focus?.race?.event_date, races]);


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

  // Post a SINGLE race's briefing to #race-announcements — each race is posted on
  // its own start time (manager/admin picks which via a button per race box).
  const [announcingId, setAnnouncingId] = useState<number | null>(null);
  const [announceResult, setAnnounceResult] = useState<{ id: number; msg: string } | null>(null);
  async function announce(raceId: number) {
    setAnnouncingId(raceId);
    setAnnounceResult(null);
    try {
      await api.announceRace(raceId);
      setAnnounceResult({ id: raceId, msg: "✅ Posted to #race-announcements." });
    } catch (err) {
      setAnnounceResult({ id: raceId, msg: `❌ ${err instanceof Error ? err.message : "Failed to post."}` });
    } finally {
      setAnnouncingId(null);
    }
  }
  // Props threaded into each RaceCard for its own Post-to-Discord footer.
  function announceProps(raceId: number) {
    return {
      announcing: announcingId === raceId,
      announceMsg: announceResult?.id === raceId ? announceResult.msg : null,
      onAnnounce: () => announce(raceId),
    };
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
            {/* ---- Featured race ---- */}
            <RaceCard
              race={focus.race}
              rankings={rankings}
              daysUntil={focus.daysUntil}
              isFeatured={isFeatured}
              weightsPreset={weights?.preset}
              canEdit={canEdit}
              roleLabel={roleLabel}
              {...announceProps(focus.race.id)}
              onRemove={() => removeRace(focus.race.id, focus.race.track_name)}
              onChanged={loadRaces}
            />

            {/* ---- Other classes racing the same weekend — identical full cards ---- */}
            {siblingRaces.length > 0 && (
              <>
                <div style={{ margin: "18px 0 8px" }}>
                  <h2 style={{ margin: 0 }}>Also racing this weekend</h2>
                  <div className="card-sub" style={{ marginBottom: 0 }}>
                    Other classes at {focus.race.track_name} on the same day — each on its own start time, posted to
                    Discord on its own.
                  </div>
                </div>
                {siblingRaces.map(({ race, rankings: sibRankings }) => (
                  <RaceCard
                    key={race.id}
                    race={race}
                    rankings={sibRankings}
                    daysUntil={focus.daysUntil}
                    isFeatured={false}
                    weightsPreset={weights?.preset}
                    canEdit={canEdit}
                    roleLabel={roleLabel}
                    {...announceProps(race.id)}
                    onRemove={() => removeRace(race.id, race.track_name)}
                    onChanged={loadRaces}
                  />
                ))}
              </>
            )}

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

        {/* ---- Engine accuracy (visible to everyone; input manager/admin) ---- */}
        <AccuracyCard tracks={tracks} cars={cars} canEdit={canEdit} roleLabel={roleLabel} />
      </div>
    </>
  );
}
