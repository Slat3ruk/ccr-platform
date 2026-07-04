"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { sessionQualityWarnings } from "@/lib/quality";
import { cleanLaps, stdDev } from "@/lib/scoring";
import { formatLapTime, parseLapTime, parseLapTimes } from "@/lib/time";
import { categoryToClass, CONDITIONS, SESSION_TYPES, SETUP_TYPES, type Benchmark, type Car, type Session, type Track } from "@/types";

interface TyreState {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

const initialTyres: TyreState = { fl: 100, fr: 100, rl: 100, rr: 100 };

/** When `edit` is passed the form updates that session (PUT); otherwise it creates one. */
export interface EditContext {
  session: Session;
  driverName: string;
}

export default function SessionForm({ edit, onDone }: { edit?: EditContext; onDone?: () => void }) {
  const isEdit = !!edit;
  const s = edit?.session;

  const [cars, setCars] = useState<Car[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);

  const [driverName, setDriverName] = useState(edit?.driverName ?? "");
  const [carId, setCarId] = useState(s ? String(s.car_id) : "");
  const [trackId, setTrackId] = useState(s ? String(s.track_id) : "");
  const [sessionType, setSessionType] = useState<string>(s?.session_type ?? "Practice");
  const [condition, setCondition] = useState<string>(s?.condition_reported ?? "Dry");
  const [bestLap, setBestLap] = useState(s ? formatLapTime(s.best_lap_time) : "");
  const [avgLap, setAvgLap] = useState(s ? formatLapTime(s.avg_lap_time) : "");
  const [lapCount, setLapCount] = useState(s ? String(s.lap_count) : "12");
  const [lapTimesText, setLapTimesText] = useState(
    s?.lap_times && s.lap_times.length ? s.lap_times.map((t) => formatLapTime(t)).join("\n") : "",
  );
  const [tyres, setTyres] = useState<TyreState>(
    s
      ? {
          fl: s.tyres.tyre_fl_pct_remaining,
          fr: s.tyres.tyre_fr_pct_remaining,
          rl: s.tyres.tyre_rl_pct_remaining,
          rr: s.tyres.tyre_rr_pct_remaining,
        }
      : initialTyres,
  );
  const [offTrack, setOffTrack] = useState(s ? String(s.off_track_count) : "0");
  const [confidence, setConfidence] = useState(s?.confidence_rating ?? 7);
  const [setupType, setSetupType] = useState(s?.setup_type ?? "");
  const [setupVersion, setSetupVersion] = useState(s?.setup_version ?? "");
  const [comments, setComments] = useState(s?.comments ?? "");

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  // Live-parse the pasted lap list; ≥2 laps unlocks true std-dev consistency.
  const parsedLaps = useMemo(() => parseLapTimes(lapTimesText), [lapTimesText]);
  const lapStats = useMemo(() => {
    if (parsedLaps.laps.length < 2) return null;
    const usable = cleanLaps(parsedLaps.laps);
    const best = Math.min(...parsedLaps.laps);
    const avg = parsedLaps.laps.reduce((a, b) => a + b, 0) / parsedLaps.laps.length;
    return {
      count: parsedLaps.laps.length,
      best,
      avg,
      sigma: usable.length >= 2 ? stdDev(usable) : null,
      excluded: parsedLaps.laps.length - usable.length,
    };
  }, [parsedLaps]);

  // Soft, non-blocking nudge if the chosen setup's trim clashes with the logged
  // weather (e.g. a Wet setup in the Dry, or a dry setup in the Wet). Cross-
  // testing is legit, so this never blocks the submit — just a sanity check.
  const setupIsWet = setupType.includes("Wet");
  const setupWeatherMismatch =
    setupType !== "" &&
    ((setupIsWet && condition !== "Wet") || (!setupIsWet && condition === "Wet"));

  /** Paste laps → best/avg/count fill themselves (still editable afterwards). */
  function onLapTimesChange(text: string) {
    setLapTimesText(text);
    const { laps } = parseLapTimes(text);
    if (laps.length >= 2) {
      setBestLap(formatLapTime(Math.min(...laps)));
      setAvgLap(formatLapTime(laps.reduce((a, b) => a + b, 0) / laps.length));
      setLapCount(String(laps.length));
    }
  }

  useEffect(() => {
    api.cars().then(setCars).catch(() => {});
    api.tracks().then(setTracks).catch(() => {});
    api.benchmarks().then(setBenchmarks).catch(() => {});
  }, []);

  // Soft, non-blocking data-quality flags (typos / dropped telemetry). Advisory
  // only — the submit confirms rather than blocks. Uses the benchmark for the
  // chosen car class + track + condition (Dry fallback) for the pace bracket.
  const qualityWarnings = useMemo(() => {
    const best = parseLapTime(bestLap);
    const avg = parseLapTime(avgLap);
    if (best == null || avg == null) return [];
    const car = cars.find((c) => c.id === Number(carId));
    const cls = car ? categoryToClass(car.category) : null;
    const tid = Number(trackId);
    const bm = cls
      ? benchmarks.find((b) => b.track_id === tid && b.class === cls && b.condition === condition) ??
        benchmarks.find((b) => b.track_id === tid && b.class === cls && b.condition === "Dry") ??
        null
      : null;
    const avgWear = 100 - (tyres.fl + tyres.fr + tyres.rl + tyres.rr) / 4;
    return sessionQualityWarnings(
      {
        best_lap_time: best,
        avg_lap_time: avg,
        lap_count: Number(lapCount) || 0,
        avg_wear_pct: avgWear,
        lap_times_count: parsedLaps.laps.length || null,
      },
      bm ? { alien_time: bm.alien_time, offline_time: bm.offline_time } : null,
    );
  }, [bestLap, avgLap, lapCount, tyres, carId, trackId, condition, cars, benchmarks, parsedLaps]);

  function reset(keepContext: boolean) {
    setBestLap("");
    setAvgLap("");
    setLapCount("12");
    setLapTimesText("");
    setTyres(initialTyres);
    setOffTrack("0");
    setComments("");
    if (!keepContext) {
      setDriverName("");
      setCarId("");
      setTrackId("");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setSuccess(null);

    const localErrors: string[] = [];
    const best = parseLapTime(bestLap);
    const avg = parseLapTime(avgLap);
    if (!driverName.trim()) localErrors.push("Driver name is required.");
    if (!carId) localErrors.push("Select a car.");
    if (!trackId) localErrors.push("Select a track.");
    if (best == null) localErrors.push("Best lap time is invalid (use M:SS.mmm, e.g. 1:42.318).");
    if (avg == null) localErrors.push("Average lap time is invalid (use M:SS.mmm).");
    if (best != null && avg != null && avg + 1e-6 < best) localErrors.push("Average lap can’t be faster than best lap.");
    if (localErrors.length) {
      setErrors(localErrors);
      return;
    }

    const payload = {
      driver_name: driverName.trim(),
      car_id: Number(carId),
      track_id: Number(trackId),
      session_type: sessionType as (typeof SESSION_TYPES)[number],
      condition_reported: condition as (typeof CONDITIONS)[number],
      lap_count: Number(lapCount),
      best_lap_time: best as number,
      avg_lap_time: avg as number,
      off_track_count: Number(offTrack),
      confidence_rating: confidence,
      setup_type: setupType || undefined,
      setup_version: setupVersion.trim() || undefined,
      comments: comments.trim() || undefined,
      lap_times: parsedLaps.laps.length >= 2 ? parsedLaps.laps : undefined,
      tyre_fl_pct_remaining: tyres.fl,
      tyre_fr_pct_remaining: tyres.fr,
      tyre_rl_pct_remaining: tyres.rl,
      tyre_rr_pct_remaining: tyres.rr,
    };

    // Soft data-quality gate: surface suspect values and let the user confirm.
    if (qualityWarnings.length > 0) {
      const ok = window.confirm(
        `Heads up — ${qualityWarnings.length} possible issue${qualityWarnings.length > 1 ? "s" : ""} with this session:\n\n• ${qualityWarnings.join("\n\n• ")}\n\n${isEdit ? "Save" : "Log"} it anyway?`,
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      if (isEdit && edit) {
        await api.updateSession(edit.session.id, payload);
        onDone?.();
      } else {
        await api.createSession(payload);
        const carName = cars.find((c) => c.id === Number(carId))?.name ?? "car";
        setSuccess(`Session logged for ${carName}. Rankings recomputed.`);
        reset(true);
      }
    } catch (e) {
      setErrors(String(e instanceof Error ? e.message : e).split("\n"));
    } finally {
      setBusy(false);
    }
  }

  const noData = cars.length === 0 || tracks.length === 0;

  return (
    <form className="content-narrow" onSubmit={submit}>
      {noData && (
        <div className="msg error">
          No cars/tracks loaded yet. Go to <strong>#rankings</strong> and click “Load sample data” first.
        </div>
      )}
      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((er, i) => (
            <li key={i}>{er}</li>
          ))}
        </ul>
      )}
      {success && <div className="msg success">{success}</div>}

      <div className="card">
        <h2>Context</h2>
        <div className="card-sub">Who drove what, where, and in what session.</div>
        <div className="row">
          <div className="field">
            <label>Driver name</label>
            <input type="text" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. Dal" />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Car</label>
            <select value={carId} onChange={(e) => setCarId(e.target.value)}>
              <option value="">Select car…</option>
              {cars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.category})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Track</label>
            <select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
              <option value="">Select track…</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Session type</label>
            <select value={sessionType} onChange={(e) => setSessionType(e.target.value)}>
              {SESSION_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Weather</label>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Lap data</h2>
        <div className="card-sub">Times as M:SS.mmm — e.g. 1:42.318.</div>
        <div className="row">
          <div className="field">
            <label>Best lap</label>
            <input type="text" value={bestLap} onChange={(e) => setBestLap(e.target.value)} placeholder="1:42.318" />
          </div>
          <div className="field">
            <label>Average lap</label>
            <input type="text" value={avgLap} onChange={(e) => setAvgLap(e.target.value)} placeholder="1:43.502" />
          </div>
          <div className="field">
            <label>Laps completed</label>
            <input type="number" min={1} value={lapCount} onChange={(e) => setLapCount(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>
            Lap times <span className="hint">(optional — unlocks true lap-to-lap consistency)</span>
          </label>
          <textarea
            rows={4}
            value={lapTimesText}
            onChange={(e) => onLapTimesChange(e.target.value)}
            placeholder={"Paste your laps — one per line or comma-separated:\n1:42.318\n1:42.905\n1:43.112"}
            style={{ fontFamily: "Consolas, monospace", fontSize: 13 }}
          />
          {lapStats && (
            <div className="lap-parse ok">
              ✓ {lapStats.count} laps parsed · best {formatLapTime(lapStats.best)} · avg {formatLapTime(lapStats.avg)}
              {lapStats.sigma != null && <> · σ {lapStats.sigma.toFixed(3)}s</>}
              {lapStats.excluded > 0 && (
                <span className="muted">
                  {" "}
                  ({lapStats.excluded} traffic/out-lap{lapStats.excluded === 1 ? "" : "s"} excluded from consistency)
                </span>
              )}
              — best/avg/count filled in for you.
            </div>
          )}
          {parsedLaps.bad.length > 0 && (
            <div className="lap-parse warn">
              Couldn’t read: {parsedLaps.bad.slice(0, 5).join(" · ")}
              {parsedLaps.bad.length > 5 ? ` (+${parsedLaps.bad.length - 5} more)` : ""}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Tyre wear</h2>
        <div className="card-sub">% remaining at the end of the run (100 = fresh).</div>
        <div className="tyre-grid">
          {(["fl", "fr", "rl", "rr"] as const).map((pos) => (
            <div className="field" key={pos} style={{ marginBottom: 4 }}>
              <label>
                {pos.toUpperCase()} — <span className="hint">{tyres[pos]}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={tyres[pos]}
                onChange={(e) => setTyres((t) => ({ ...t, [pos]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Incidents &amp; assessment</h2>
        <div className="row">
          <div className="field">
            <label>Off-track count</label>
            <input type="number" min={0} value={offTrack} onChange={(e) => setOffTrack(e.target.value)} />
          </div>
          <div className="field">
            <label>
              Confidence in car — <span className="hint">{confidence}/10</span>
            </label>
            <div className="slider-row">
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
              />
              <span className="slider-val">{confidence}</span>
            </div>
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>Setup <span className="hint">(optional)</span></label>
            <select value={setupType} onChange={(e) => setSetupType(e.target.value)}>
              <option value="">— none / not listed —</option>
              {SETUP_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value} ({t.code})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Setup version <span className="hint">(optional)</span></label>
            <input type="text" value={setupVersion} onChange={(e) => setSetupVersion(e.target.value)} placeholder="e.g. 1.3.3 or GMR001" />
          </div>
        </div>
        {setupWeatherMismatch && (
          <div className="lap-parse" style={{ color: "var(--yellow)", marginTop: -6 }}>
            ⚠ You picked a {setupIsWet ? "Wet" : "dry-weather"} setup but logged {condition} conditions — fine if that’s intended, just flagging it.
          </div>
        )}
        {qualityWarnings.length > 0 && (
          <div className="quality-warn">
            <div className="qw-head">⚠ Sanity check — {qualityWarnings.length} thing{qualityWarnings.length > 1 ? "s" : ""} to double-check</div>
            <ul>
              {qualityWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <div className="qw-foot">Not blocking — you'll just be asked to confirm on {isEdit ? "save" : "log"}.</div>
          </div>
        )}
        <div className="field">
          <label>Comments <span className="hint">(optional)</span></label>
          <textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Understeer on entry, strong on traction…" />
        </div>
      </div>

      <div className="flex" style={{ gap: 10 }}>
        <button type="submit" className="btn" disabled={busy || noData}>
          {busy ? (isEdit ? "Saving…" : "Logging…") : isEdit ? "Save changes" : "Log session"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => (isEdit ? onDone?.() : reset(false))}
          disabled={busy}
        >
          {isEdit ? "Cancel" : "Clear"}
        </button>
      </div>
    </form>
  );
}
