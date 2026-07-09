"use client";

// ============================================================================
// Prediction accuracy — the engine's report card, at the bottom of the
// briefing. Visible to EVERY role (drivers included — trust is the point);
// the input form + delete are Team Manager / Admin only. When a result is
// logged, the board's current #1 for that track+class is snapshotted as the
// "pick" so later recomputes can't rewrite history.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { summarizeAccuracy } from "@/lib/accuracy";
import { RACING_CLASSES, RESULT_VERDICTS, categoryToClass } from "@/types";
import type { Car, RaceResult, RacingClass, ResultVerdict, Track } from "@/types";

const VERDICT_STYLE: Record<ResultVerdict, { color: string; label: string }> = {
  nailed: { color: "var(--green)", label: "Nailed it" },
  solid: { color: "var(--yellow)", label: "Solid" },
  missed: { color: "var(--red)", label: "Missed" },
};

export default function AccuracyCard({
  tracks,
  cars,
  canEdit,
  roleLabel,
}: {
  tracks: Track[];
  cars: Car[];
  canEdit: boolean;
  roleLabel: string;
}) {
  const [results, setResults] = useState<RaceResult[]>([]);
  const [loaded, setLoaded] = useState(false);

  // form state (manager/admin)
  const [showForm, setShowForm] = useState(false);
  const [fTrack, setFTrack] = useState("");
  const [fClass, setFClass] = useState<RacingClass | "">("");
  const [fDate, setFDate] = useState("");
  const [fCar, setFCar] = useState("");
  const [fVerdict, setFVerdict] = useState<ResultVerdict | "">("");
  const [fPosition, setFPosition] = useState("");
  const [fNote, setFNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setResults(await api.raceResults().catch(() => []));
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => summarizeAccuracy(results), [results]);
  const trackName = useCallback(
    (id: number) => tracks.find((t) => t.id === id)?.name ?? `track #${id}`,
    [tracks],
  );
  const carName = useCallback((id: number | null) => (id == null ? null : cars.find((c) => c.id === id)?.name ?? `car #${id}`), [cars]);

  // Cars eligible for the selected class (both LMP2 flavours share LMP2 cars).
  const classCars = useMemo(() => {
    if (!fClass) return cars;
    return cars.filter((c) =>
      fClass.startsWith("LMP2") ? c.category === "LMP2" : categoryToClass(c.category) === fClass,
    );
  }, [cars, fClass]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!fTrack || !fClass || !fDate || !fCar || !fVerdict) {
      setErr("Track, class, date, car raced and verdict are all required.");
      return;
    }
    setBusy(true);
    try {
      // Snapshot the board's current pick for this combo (top row wins).
      const pick = await api
        .rankings({ track_id: Number(fTrack), class: fClass })
        .then((rows) => rows[0]?.car_id ?? null)
        .catch(() => null);
      await api.createRaceResult({
        track_id: Number(fTrack),
        class: fClass,
        raced_on: fDate,
        raced_car_id: Number(fCar),
        verdict: fVerdict,
        recommended_car_id: pick,
        position: fPosition.trim() || null,
        note: fNote.trim() || null,
        created_by: roleLabel,
      });
      setFTrack("");
      setFClass("");
      setFDate("");
      setFCar("");
      setFVerdict("");
      setFPosition("");
      setFNote("");
      setShowForm(false);
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to log the result.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Remove this result from the scoreboard?")) return;
    await api.deleteRaceResult(id).catch(() => {});
    await load();
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h2>Engine accuracy</h2>
      <div className="card-sub">
        How the briefing&rsquo;s pick actually went on race day — logged after each race
        {canEdit ? "" : " by a Team Manager"}. The pick is snapshotted at logging time, so this scoreboard is honest.
      </div>

      {/* --- scoreboard ------------------------------------------------------ */}
      {summary.n === 0 ? (
        loaded && (
          <div className="muted" style={{ fontSize: 13 }}>
            No race results logged yet — after the next race, the scoreboard starts here.
          </div>
        )
      ) : (
        <div className="row" style={{ alignItems: "center", gap: 18, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>
              {summary.hitPct}
              <span style={{ fontSize: 18, fontWeight: 700 }}>%</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              right calls · {summary.n} race{summary.n === 1 ? "" : "s"}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {(["nailed", "solid", "missed"] as const).map((v) => (
              <span
                key={v}
                className="pill"
                style={{ borderColor: VERDICT_STYLE[v].color, color: VERDICT_STYLE[v].color }}
              >
                {VERDICT_STYLE[v].label} · {summary[v]}
              </span>
            ))}
            {summary.withPick > 0 && (
              <span className="pill" title="How often the team actually raced the engine's pick">
                ran the pick {summary.followed}/{summary.withPick}
              </span>
            )}
          </div>
        </div>
      )}

      {/* --- results list ---------------------------------------------------- */}
      {results.map((r) => {
        const ran = carName(r.raced_car_id);
        const pick = carName(r.recommended_car_id);
        const overruled = r.recommended_car_id != null && r.recommended_car_id !== r.raced_car_id;
        return (
          <div
            key={r.id}
            className="row"
            style={{
              alignItems: "center",
              gap: 10,
              padding: "8px 0",
              borderTop: "1px solid var(--border)",
              fontSize: 13,
            }}
          >
            <span
              className="pill"
              style={{ borderColor: VERDICT_STYLE[r.verdict].color, color: VERDICT_STYLE[r.verdict].color, flexShrink: 0 }}
            >
              {VERDICT_STYLE[r.verdict].label}
            </span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div>
                <strong>{trackName(r.track_id)}</strong> <span className="muted">· {r.class} · {r.raced_on}</span>
              </div>
              <div className="muted">
                ran {ran}
                {overruled ? ` (pick was ${pick})` : pick ? " — the pick" : ""}
                {r.position ? ` · ${r.position}` : ""}
                {r.note ? ` · ${r.note}` : ""}
              </div>
            </div>
            {canEdit && (
              <button className="btn btn-ghost btn-sm" onClick={() => remove(r.id)}>
                Remove
              </button>
            )}
          </div>
        );
      })}

      {/* --- input (manager/admin only) --------------------------------------- */}
      {canEdit && !showForm && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setShowForm(true)}>
          + Log a race result
        </button>
      )}
      {canEdit && showForm && (
        <form onSubmit={submit} style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="row">
            <div className="field" style={{ minWidth: 160 }}>
              <label>Track</label>
              <select value={fTrack} onChange={(e) => setFTrack(e.target.value)}>
                <option value="">Select track…</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 130 }}>
              <label>Class</label>
              <select
                value={fClass}
                onChange={(e) => {
                  setFClass(e.target.value as RacingClass | "");
                  setFCar("");
                }}
              >
                <option value="">Select class…</option>
                {RACING_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 140, flex: "0 0 auto" }}>
              <label>Race day</label>
              <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ minWidth: 180 }}>
              <label>Car raced</label>
              <select value={fCar} onChange={(e) => setFCar(e.target.value)}>
                <option value="">Select car…</option>
                {classCars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label>
                Result <span className="hint">(optional)</span>
              </label>
              <input
                type="text"
                value={fPosition}
                placeholder="e.g. P3 in class"
                onChange={(e) => setFPosition(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>Verdict — was the pick the right call?</label>
            <div className="row" style={{ gap: 8 }}>
              {RESULT_VERDICTS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  className={`btn btn-sm ${fVerdict === v.value ? "" : "btn-ghost"}`}
                  title={v.hint}
                  onClick={() => setFVerdict(v.value)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>
              Note <span className="hint">(optional)</span>
            </label>
            <input
              type="text"
              value={fNote}
              placeholder="e.g. tyre wear won it for us in the final hour"
              onChange={(e) => setFNote(e.target.value)}
            />
          </div>
          {err && (
            <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{err}</div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Logging…" : "Log result"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
