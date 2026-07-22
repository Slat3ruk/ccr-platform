"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useRole } from "@/lib/role";
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

/** Wear severity → the LMU tyre-phase palette (low wear green, high wear red). */
function wearColor(wear: number): string {
  if (wear <= 20) return "var(--green)";
  if (wear <= 50) return "var(--yellow)";
  return "var(--red)";
}

/**
 * Live tyre-wear wheel — a ring gauge of the AVERAGE wear (mirrors the
 * driver-board gauge) plus a per-corner readout, updating as the driver drags
 * the four sliders. Gives immediate feedback on what they're entering.
 */
function TyreWearGauge({ tyres }: { tyres: TyreState }) {
  const wear = (remaining: number) => Math.max(0, Math.min(100, 100 - remaining));
  const avg = (wear(tyres.fl) + wear(tyres.fr) + wear(tyres.rl) + wear(tyres.rr)) / 4;
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = (avg / 100) * c;
  return (
    <div className="tyre-wheel">
      <svg viewBox="0 0 80 80" width={104} height={104}>
        <circle cx={40} cy={40} r={r} fill="none" stroke="var(--bg-active)" strokeWidth={8} />
        <circle
          cx={40}
          cy={40}
          r={r}
          fill="none"
          stroke={wearColor(avg)}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 40 40)"
        />
        <text x={40} y={38} textAnchor="middle" fontSize={16} fontWeight={700} fill="var(--text)">
          {Math.round(avg)}%
        </text>
        <text x={40} y={51} textAnchor="middle" fontSize={7} fill="var(--text-faint)">
          avg wear
        </text>
      </svg>
      <div className="tyre-wheel-corners">
        {(["fl", "fr", "rl", "rr"] as const).map((pos) => (
          <div className="tw-corner" key={pos}>
            <span className="tw-dot" style={{ background: wearColor(wear(tyres[pos])) }} />
            {pos.toUpperCase()} <span className="muted">{wear(tyres[pos])}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** When `edit` is passed the form updates that session (PUT); otherwise it creates one. */
export interface EditContext {
  session: Session;
  driverName: string;
}

export default function SessionForm({ edit, onDone }: { edit?: EditContext; onDone?: () => void }) {
  const isEdit = !!edit;
  const s = edit?.session;
  const { role, name: sessionName } = useRole();
  // New sessions (not edits) from a Driver are locked to their own verified
  // Discord identity — see AUTH-CONTRACT.md; managers/admins keep free text
  // for logging on a teammate's behalf.
  const driverNameLocked = !isEdit && role === "driver";

  const [cars, setCars] = useState<Car[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [currentPatch, setCurrentPatch] = useState<string | null>(null);

  const [driverName, setDriverName] = useState(edit?.driverName ?? "");
  const [driverOptions, setDriverOptions] = useState<string[]>([]);

  // Pre-fill with the caller's own verified name on a fresh (non-edit) form —
  // Drivers stay locked to it (see driverNameLocked above); Manager/Admin get
  // it as a starting point but can clear it to log on a teammate's behalf,
  // picking from driverOptions below or typing a brand-new name.
  useEffect(() => {
    if (!isEdit && sessionName) setDriverName((cur) => cur || sessionName);
  }, [isEdit, sessionName]);

  useEffect(() => {
    if (!driverNameLocked) api.roster().then((r) => setDriverOptions(r.roster.map((m) => m.name))).catch(() => {});
  }, [driverNameLocked]);
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
  // Consumption per lap — optional, not scored, captured for the strategy tool.
  const [fuelPerLap, setFuelPerLap] = useState(s?.fuel_per_lap == null ? "" : String(s.fuel_per_lap));
  const [vePerLap, setVePerLap] = useState(s?.ve_per_lap == null ? "" : String(s.ve_per_lap));

  // Only Hypercar + GT3 run Virtual Energy in LMU; LMP2/LMP3 have none.
  const veApplies = useMemo(() => {
    const cat = cars.find((c) => String(c.id) === String(carId))?.category;
    return cat === "Hypercar" || cat === "GT3";
  }, [cars, carId]);

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
    api.patch().then((p) => setCurrentPatch(p.current_patch)).catch(() => {});
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
        setup_version: setupVersion.trim() || null,
        // a new session will be stamped with the current patch; compare against it
        patch_version: isEdit ? s?.patch_version ?? null : currentPatch,
      },
      bm ? { alien_time: bm.alien_time, offline_time: bm.offline_time } : null,
    );
  }, [bestLap, avgLap, lapCount, tyres, carId, trackId, condition, cars, benchmarks, parsedLaps, setupVersion, currentPatch, isEdit, s]);

  function reset(keepContext: boolean) {
    setBestLap("");
    setAvgLap("");
    setLapCount("12");
    setLapTimesText("");
    setTyres(initialTyres);
    setOffTrack("0");
    setComments("");
    setFuelPerLap("");
    setVePerLap("");
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
      fuel_per_lap: fuelPerLap.trim() ? Number(fuelPerLap) : undefined,
      ve_per_lap: vePerLap.trim() ? Number(vePerLap) : undefined,
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
          No cars/tracks loaded yet. Go to <strong>#rankings</strong> and click “Load reference data” first, or
          ask an admin.
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
            <input
              type="text"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="e.g. Dal"
              disabled={driverNameLocked}
              list={driverNameLocked ? undefined : "driver-options"}
              autoComplete="off"
            />
            {!driverNameLocked && (
              <datalist id="driver-options">
                {driverOptions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            )}
            {driverNameLocked && (
              <div className="card-sub" style={{ marginTop: 4 }}>
                Locked to your Discord identity — a manager/admin can log on your behalf instead.
              </div>
            )}
            {!driverNameLocked && (
              <div className="card-sub" style={{ marginTop: 4 }}>
                Pre-filled with your name — clear it and pick from the team roster, or type a new name, to log
                on their behalf.
              </div>
            )}
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
        <div className="tyre-wear-layout">
          <div className="tyre-grid" style={{ flex: 1 }}>
            {(["fl", "fr", "rl", "rr"] as const).map((pos) => (
              <div className="field" key={pos} style={{ marginBottom: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {pos.toUpperCase()} —
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    inputMode="numeric"
                    value={tyres[pos]}
                    aria-label={`${pos.toUpperCase()} tyre % remaining`}
                    onKeyDown={(e) => {
                      // type=number still permits these; keep it integers-only.
                      if (["e", "E", "+", "-", "."].includes(e.key)) e.preventDefault();
                    }}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setTyres((t) => ({ ...t, [pos]: 0 }));
                        return;
                      }
                      const n = Math.round(Number(raw));
                      if (Number.isNaN(n)) return;
                      setTyres((t) => ({ ...t, [pos]: Math.max(0, Math.min(100, n)) }));
                    }}
                    style={{ width: 56, padding: "2px 6px" }}
                  />
                  <span className="hint">%</span>
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
          <TyreWearGauge tyres={tyres} />
        </div>
      </div>

      <div className="card">
        <h2>
          Consumption <span className="hint">(optional)</span>
        </h2>
        <div className="card-sub">
          Not used in scoring — captured so the strategy tool can plan stints from real data later. It can&rsquo;t be
          worked out after the fact, so it&rsquo;s worth a few seconds now if you have the numbers.
        </div>
        <div className="row">
          <div className="field">
            <label>
              Fuel per lap <span className="hint">litres</span>
            </label>
            <input
              type="number"
              min={0}
              max={30}
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 3.4"
              value={fuelPerLap}
              onChange={(e) => setFuelPerLap(e.target.value)}
            />
          </div>
          <div className="field">
            <label>
              Virtual Energy per lap <span className="hint">%</span>
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              inputMode="decimal"
              placeholder={veApplies ? "e.g. 2.8" : "n/a for this class"}
              value={vePerLap}
              disabled={!veApplies}
              onChange={(e) => setVePerLap(e.target.value)}
            />
            {!veApplies && carId && (
              <div className="hint">Only Hypercar and GT3 use Virtual Energy in LMU.</div>
            )}
          </div>
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
            <label>Setup patch <span className="hint">(which patch the setup was built on)</span></label>
            <input type="text" value={setupVersion} onChange={(e) => setSetupVersion(e.target.value)} placeholder={currentPatch ? `e.g. ${currentPatch}` : "e.g. 1.3.3.4"} />
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
