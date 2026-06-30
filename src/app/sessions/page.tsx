"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { formatLapTime } from "@/lib/time";
import type { Car, Driver, Session, Track } from "@/types";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cars, setCars] = useState<Map<number, Car>>(new Map());
  const [tracks, setTracks] = useState<Map<number, Track>>(new Map());
  const [drivers, setDrivers] = useState<Map<number, Driver>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [s, c, t, d] = await Promise.all([
      api.sessions({ limit: 200 }),
      api.cars(),
      api.tracks(),
      fetch("/api/drivers", { cache: "no-store" }).then((r) => r.json() as Promise<Driver[]>),
    ]);
    setSessions(s);
    setCars(new Map(c.map((x) => [x.id, x])));
    setTracks(new Map(t.map((x) => [x.id, x])));
    setDrivers(new Map(d.map((x) => [x.id, x])));
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  async function remove(id: number) {
    if (!confirm("Delete this session and recompute rankings?")) return;
    await api.deleteSession(id);
    load();
  }

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>session-log</h1>
        <span className="sub">{sessions.length} sessions</span>
      </div>
      <div className="content">
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} style={{ cursor: "default" }}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(s.created_at).toLocaleDateString()}
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
                    <td className="num">{s.session_value_score != null ? s.session_value_score.toFixed(0) : "—"}</td>
                    <td className="muted">{s.setup_version || "—"}</td>
                    <td className="notes-cell" title={s.comments || ""}>
                      {s.comments ? s.comments : <span className="muted">—</span>}
                    </td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(s.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
