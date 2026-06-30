"use client";

import { Fragment, useState } from "react";
import { api } from "@/lib/api-client";
import { confidenceColor, factorColor, fmtPct, fmtScore, scoreColor } from "@/lib/format";
import { formatLapTime } from "@/lib/time";
import { FACTOR_WEIGHTS } from "@/lib/scoring";
import type { RankingRow, Session } from "@/types";

const FACTORS: { key: keyof typeof FACTOR_WEIGHTS; label: string; field: keyof RankingRow }[] = [
  { key: "pace", label: "Pace", field: "pace_factor" },
  { key: "consistency", label: "Consistency", field: "consistency_factor" },
  { key: "tyre", label: "Tyre", field: "tyre_factor" },
  { key: "drivability", label: "Drivability", field: "drivability_factor" },
  { key: "mistakes", label: "Mistakes", field: "mistakes_factor" },
];

function FactorCell({ value }: { value: number }) {
  return (
    <div className="factor-bar">
      <div className="bar">
        <span style={{ width: `${value}%`, background: factorColor(value) }} />
      </div>
      <span className="val">{Math.round(value)}</span>
    </div>
  );
}

export default function RankingsTable({ rows }: { rows: RankingRow[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detailSessions, setDetailSessions] = useState<Record<number, Session[]>>({});

  async function toggle(row: RankingRow) {
    if (expanded === row.id) {
      setExpanded(null);
      return;
    }
    setExpanded(row.id);
    if (!detailSessions[row.id]) {
      try {
        const sessions = await api.sessions({ car_id: row.car_id, track_id: row.track_id, limit: 10 });
        setDetailSessions((m) => ({ ...m, [row.id]: sessions }));
      } catch {
        setDetailSessions((m) => ({ ...m, [row.id]: [] }));
      }
    }
  }

  if (rows.length === 0) {
    return (
      <div className="empty">
        <div className="big">🏁</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>No rankings yet</div>
        <div>Log a few sessions for this track/class and they’ll appear here, ranked by Car Score.</div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="rank">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Car</th>
            <th className="num">Score</th>
            {FACTORS.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th className="num">Sessions</th>
            <th className="num">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isOpen = expanded === row.id;
            return (
              <Fragment key={row.id}>
                <tr className={isOpen ? "expanded" : ""} onClick={() => toggle(row)}>
                  <td className="num rank-pos">{i + 1}</td>
                  <td>
                    <div className="car-cell">
                      <span className="car-name">{row.car_name}</span>
                      <span className="car-cat">
                        {row.car_category} · {row.track_name}
                      </span>
                    </div>
                  </td>
                  <td className="num">
                    <span className="score-pill" style={{ background: scoreColor(row.car_score) }}>
                      {fmtScore(row.car_score)}
                    </span>
                  </td>
                  {FACTORS.map((f) => (
                    <td key={f.key}>
                      <FactorCell value={Number(row[f.field])} />
                    </td>
                  ))}
                  <td className="num">{row.sessions_used}</td>
                  <td className="num">
                    <span className="conf" style={{ justifyContent: "center" }}>
                      <span className="dot" style={{ background: confidenceColor(row.confidence_score) }} />
                      {fmtPct(row.confidence_score)}
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="detail-row">
                    <td colSpan={9}>
                      <div className="detail-inner">
                        <div className="detail-grid">
                          {FACTORS.map((f) => {
                            const v = Number(row[f.field]);
                            return (
                              <div className="detail-factor" key={f.key}>
                                <div className="name">{f.label}</div>
                                <div className="num" style={{ color: scoreColor(v) }}>
                                  {fmtScore(v)}
                                </div>
                                <div className="weight">weight {Math.round(FACTOR_WEIGHTS[f.key] * 100)}%</div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex spread" style={{ marginBottom: 8 }}>
                          <strong style={{ fontSize: 13 }}>
                            Contributing sessions ({row.sessions_used})
                          </strong>
                          <span className="muted" style={{ fontSize: 12 }}>
                            class {row.class} · {row.condition} · updated{" "}
                            {new Date(row.last_updated).toLocaleString()}
                          </span>
                        </div>
                        <div className="session-list">
                          {(detailSessions[row.id] ?? []).length === 0 && (
                            <div className="muted">Loading sessions…</div>
                          )}
                          {(detailSessions[row.id] ?? []).map((s) => (
                            <div className="sess" key={s.id}>
                              <span style={{ minWidth: 90 }}>{s.session_type}</span>
                              <span>best {formatLapTime(s.best_lap_time)}</span>
                              <span>avg {formatLapTime(s.avg_lap_time)}</span>
                              <span>{s.lap_count} laps</span>
                              <span>{s.off_track_count} OT</span>
                              <span>wear {s.tyres.avg_wear_pct.toFixed(0)}%</span>
                              <span>conf {s.confidence_rating}/10</span>
                              {s.session_value_score != null && (
                                <span className="muted">SVS {s.session_value_score.toFixed(0)}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
