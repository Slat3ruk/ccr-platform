"use client";

import { useCallback, useEffect, useState } from "react";
import SessionForm from "@/components/SessionForm";
import { api } from "@/lib/api-client";
import { sessionQualityWarnings } from "@/lib/quality";
import { useRole } from "@/lib/role";
import { formatLapTime } from "@/lib/time";
import { categoryToClass, type Benchmark, type Car, type Driver, type Session, type Track } from "@/types";

export default function SessionsPage() {
  const { role } = useRole();
  // Editing/deleting logged sessions is a Team Manager/Admin action; drivers
  // get a read-only log. (Phase 1 = client-side gate; Phase 2 OAuth enforces it.)
  const canManage = role !== "driver";
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cars, setCars] = useState<Map<number, Car>>(new Map());
  const [tracks, setTracks] = useState<Map<number, Track>>(new Map());
  const [drivers, setDrivers] = useState<Map<number, Driver>>(new Map());
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Session | null>(null);

  const load = useCallback(async () => {
    const [s, c, t, d, bm] = await Promise.all([
      api.sessions({ limit: 200 }),
      api.cars(),
      api.tracks(),
      fetch("/api/drivers", { cache: "no-store" }).then((r) => r.json() as Promise<Driver[]>),
      api.benchmarks().catch(() => [] as Benchmark[]),
    ]);
    setSessions(s);
    setCars(new Map(c.map((x) => [x.id, x])));
    setTracks(new Map(t.map((x) => [x.id, x])));
    setDrivers(new Map(d.map((x) => [x.id, x])));
    setBenchmarks(bm);
    setLoading(false);
  }, []);

  /** Soft data-quality flags for a logged row (same checks as the log form). */
  function warningsFor(s: Session): string[] {
    const car = cars.get(s.car_id);
    const cls = car ? categoryToClass(car.category) : null;
    const bm = cls
      ? benchmarks.find((b) => b.track_id === s.track_id && b.class === cls && b.condition === s.condition_reported) ??
        benchmarks.find((b) => b.track_id === s.track_id && b.class === cls && b.condition === "Dry") ??
        null
      : null;
    return sessionQualityWarnings(
      {
        best_lap_time: s.best_lap_time,
        avg_lap_time: s.avg_lap_time,
        lap_count: s.lap_count,
        avg_wear_pct: s.tyres.avg_wear_pct,
        lap_times_count: s.lap_times?.length ?? null,
        setup_version: s.setup_version,
        patch_version: s.patch_version,
      },
      bm ? { alien_time: bm.alien_time, offline_time: bm.offline_time } : null,
    );
  }

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  async function remove(id: number) {
    if (!confirm("Delete this session and recompute rankings?")) return;
    await api.deleteSession(id);
    load();
  }

  function startEdit(s: Session) {
    setEditing(s);
    document.querySelector(".content")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>session-log</h1>
        <span className="sub">{sessions.length} sessions</span>
      </div>
      <div className="content">
        {canManage && editing && (
          <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: "1px solid var(--border-soft)" }}>
            <div className="flex spread" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>
                Editing — {cars.get(editing.car_id)?.name ?? `#${editing.car_id}`} @{" "}
                {tracks.get(editing.track_id)?.name ?? `#${editing.track_id}`}
              </h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                Close
              </button>
            </div>
            <SessionForm
              key={editing.id}
              edit={{ session: editing, driverName: drivers.get(editing.driver_id)?.name ?? "" }}
              onDone={() => {
                setEditing(null);
                load();
              }}
            />
          </div>
        )}
        {loading ? (
          <div className="empty">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="empty">
            <div className="big">📋</div>
            <div style={{ fontWeight: 700 }}>No sessions logged yet</div>
            <div>Head to #log-session to add the first run.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Driver</th>
                  <th>Car</th>
                  <th>Track</th>
                  <th>Type</th>
                  <th>Best</th>
                  <th>Avg</th>
                  <th className="num">Laps</th>
                  <th className="num">OT</th>
                  <th className="num">Wear</th>
                  <th className="num">Conf</th>
                  <th className="num">SVS</th>
                  <th>Setup</th>
                  <th>Notes</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const warns = warningsFor(s);
                  return (
                  <tr key={s.id} style={{ cursor: "default" }}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(s.created_at).toLocaleDateString()}
                      {warns.length > 0 && (
                        <span className="qflag" title={`Data-quality check:\n\n• ${warns.join("\n• ")}`}>
                          ⚠
                        </span>
                      )}
                    </td>
                    <td>{drivers.get(s.driver_id)?.name ?? `#${s.driver_id}`}</td>
                    <td>{cars.get(s.car_id)?.name ?? `#${s.car_id}`}</td>
                    <td>{tracks.get(s.track_id)?.name ?? `#${s.track_id}`}</td>
                    <td>
                      <span className="pill">{s.session_type}</span>
                    </td>
                    <td>{formatLapTime(s.best_lap_time)}</td>
                    <td>{formatLapTime(s.avg_lap_time)}</td>
                    <td className="num">{s.lap_count}</td>
                    <td className="num">{s.off_track_count}</td>
                    <td className="num">{s.tyres.avg_wear_pct.toFixed(0)}%</td>
                    <td className="num">{s.confidence_rating}</td>
                    <td
                      className="num"
                      style={canManage && s.value_components ? { cursor: "help", textDecoration: "underline dotted", textUnderlineOffset: 3 } : undefined}
                      title={
                        canManage && s.value_components
                          ? `Session Value Score — why this session weighs what it does:\n\n` +
                            `Completeness (30%): ${s.value_components.completeness.toFixed(0)}\n` +
                            `Consistency (25%): ${s.value_components.consistency.toFixed(0)}\n` +
                            `Cleanliness (20%): ${s.value_components.cleanliness.toFixed(0)}\n` +
                            `Representativeness (15%): ${s.value_components.representativeness.toFixed(0)}\n` +
                            `Recency (10%): ${s.value_components.recency.toFixed(0)}\n\n` +
                            `Full maths: #how-scoring-works`
                          : undefined
                      }
                    >
                      {s.session_value_score != null ? s.session_value_score.toFixed(0) : "—"}
                    </td>
                    <td className="muted">
                      {s.setup_type || s.setup_version ? (
                        <>
                          {s.setup_type ?? ""}
                          {s.setup_type && s.setup_version ? " " : ""}
                          {s.setup_version ? <span className="hint">{s.setup_version}</span> : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="notes-cell" title={s.comments || ""}>
                      {s.comments ? s.comments : <span className="muted">—</span>}
                    </td>
                    {canManage && (
                      <td>
                        <div className="flex" style={{ gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => startEdit(s)}>
                            Edit
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => remove(s.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
