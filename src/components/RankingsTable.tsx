"use client";

import { Fragment, useState } from "react";
import { api } from "@/lib/api-client";
import { confidenceColor, confidenceTitle, factorColor, fmtPct, fmtScore, scoreColor } from "@/lib/format";
import { formatLapTime } from "@/lib/time";
import { FACTOR_WEIGHTS } from "@/lib/scoring";
import type { Role } from "@/lib/role";
import type { FactorWeights, RankingRow, Session, ValueComponents } from "@/types";

const FACTORS: { key: keyof typeof FACTOR_WEIGHTS; label: string; field: keyof RankingRow }[] = [
  { key: "pace", label: "Pace", field: "pace_factor" },
  { key: "consistency", label: "Consistency", field: "consistency_factor" },
  { key: "tyre", label: "Tyre", field: "tyre_factor" },
  { key: "drivability", label: "Drivability", field: "drivability_factor" },
  { key: "mistakes", label: "Mistakes", field: "mistakes_factor" },
];

// Session Value Score components — full labels + a plain-English tooltip for
// each, shown on the Admin per-session debug line (0–100 each). Weighted into
// SVS as: Completeness 30 · Consistency 25 · Cleanliness 20 · Representativeness
// 15 · Recency 10 (see SVS_WEIGHTS in scoring.ts).
const SVS_COMPONENTS: { key: keyof ValueComponents; label: string; hint: string }[] = [
  { key: "completeness", label: "Completeness", hint: "Did they run a proper stint? (based on lap count)" },
  { key: "consistency", label: "Consistency", hint: "Tight, repeatable laps (small best→average gap)" },
  { key: "cleanliness", label: "Cleanliness", hint: "Few off-tracks / mistakes" },
  {
    key: "representativeness",
    label: "Representativeness",
    hint: "How race-relevant: Race/Quali count more than Practice/Test, dry more than wet",
  },
  { key: "recency", label: "Recency", hint: "Fresh runs count more than old ones" },
];

function verdict(score: number): string {
  if (score >= 85) return "Top pick";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Viable";
  if (score >= 45) return "Marginal";
  return "Avoid";
}

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

export default function RankingsTable({
  rows,
  role = "manager",
  activeWeights,
}: {
  rows: RankingRow[];
  role?: Role;
  activeWeights?: FactorWeights;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detailSessions, setDetailSessions] = useState<Record<number, Session[]>>({});
  const weightFor = (key: keyof typeof FACTOR_WEIGHTS) => activeWeights?.[key] ?? FACTOR_WEIGHTS[key];

  const showFactors = role !== "driver";
  const showSessions = role !== "driver";
  const showDebug = role === "admin";
  const colSpan = role === "driver" ? 4 : 10;

  async function toggle(row: RankingRow) {
    if (expanded === row.id) {
      setExpanded(null);
      return;
    }
    setExpanded(row.id);
    if (showSessions && !detailSessions[row.id]) {
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
            {showFactors ? (
              FACTORS.map((f) => <th key={f.key}>{f.label}</th>)
            ) : (
              <th>Verdict</th>
            )}
            {showFactors && <th className="num">Sessions</th>}
            {showFactors && <th className="num">Confidence</th>}
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
                      <span className="car-name">
                        {row.car_name}
                        {row.weights_preset && (
                          <span className="preset-tag" title={`Ranked using the ${row.weights_preset} weighting`}>
                            <span className="tag-dot" />
                            {row.weights_preset}
                          </span>
                        )}
                      </span>
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
                  {showFactors ? (
                    <>
                      {FACTORS.map((f) => (
                        <td key={f.key}>
                          <FactorCell value={Number(row[f.field])} />
                        </td>
                      ))}
                      <td className="num">{row.sessions_used}</td>
                      <td className="num" title={confidenceTitle(row.confidence_score, row.sessions_used)}>
                        <span className="conf" style={{ justifyContent: "center", cursor: "help" }}>
                          <span className="dot" style={{ background: confidenceColor(row.confidence_score) }} />
                          {fmtPct(row.confidence_score)}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td>
                      <span className="pill" style={{ background: scoreColor(row.car_score), color: "#0c0c0c" }}>
                        {verdict(row.car_score)}
                      </span>
                    </td>
                  )}
                </tr>
                {isOpen && (
                  <tr className="detail-row">
                    <td colSpan={colSpan}>
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
                                <div className="weight">weight {Math.round(weightFor(f.key) * 100)}%</div>
                              </div>
                            );
                          })}
                        </div>

                        {showSessions && (
                          <>
                            <div className="flex spread" style={{ marginBottom: 8 }}>
                              <strong style={{ fontSize: 13 }}>Contributing sessions ({row.sessions_used})</strong>
                              <span className="muted" style={{ fontSize: 12 }}>
                                class {row.class} · {row.condition} · {fmtPct(row.confidence_score)} confidence · updated{" "}
                                {new Date(row.last_updated).toLocaleString()}
                              </span>
                            </div>
                            <div className="session-list">
                              {(detailSessions[row.id] ?? []).length === 0 && (
                                <div className="muted">Loading sessions…</div>
                              )}
                              {(detailSessions[row.id] ?? []).map((s) => (
                                <div className="sess" key={s.id}>
                                  <span style={{ minWidth: 84 }}>{s.session_type}</span>
                                  <span>best {formatLapTime(s.best_lap_time)}</span>
                                  <span>avg {formatLapTime(s.avg_lap_time)}</span>
                                  <span>{s.lap_count} laps</span>
                                  <span>{s.off_track_count} OT</span>
                                  <span>wear {s.tyres.avg_wear_pct.toFixed(0)}%</span>
                                  <span>conf {s.confidence_rating}/10</span>
                                  {s.setup_version && <span className="muted">setup: {s.setup_version}</span>}
                                  {s.session_value_score != null && (
                                    <span className="muted">SVS {s.session_value_score.toFixed(0)}</span>
                                  )}
                                  {showDebug && s.value_components && (
                                    <span className="svs-components" style={{ flexBasis: "100%", fontSize: 12 }}>
                                      <span className="muted">Session value · </span>
                                      {SVS_COMPONENTS.map((c, idx) => (
                                        <Fragment key={c.key}>
                                          {idx > 0 && <span className="muted"> · </span>}
                                          <span className="svs-comp" title={c.hint}>
                                            {c.label} {s.value_components![c.key].toFixed(0)}
                                          </span>
                                        </Fragment>
                                      ))}
                                    </span>
                                  )}
                                  {s.comments && (
                                    <span style={{ flexBasis: "100%", color: "var(--text-muted)" }}>
                                      💬 {s.comments}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </>
                        )}

                        {!showSessions && (
                          <div className="muted" style={{ fontSize: 13 }}>
                            Based on {row.sessions_used} logged session{row.sessions_used === 1 ? "" : "s"} ·{" "}
                            {verdict(row.car_score)} for this track.
                          </div>
                        )}
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
