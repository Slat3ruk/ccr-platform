"use client";

// ============================================================================
// Driver leaderboard — friendly-competition view over the SAME per-session
// factor scores the car rankings use, just grouped by driver instead of car.
// Read-only, no role gating (the whole point is to get people testing more).
// V1 scope: "overall" only (all cars/tracks/conditions blended per driver);
// per-track/per-car drill-down can follow once the badges prove themselves.
// ============================================================================

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { BadgeDef, DriverStat } from "@/types";

const TIER_MEDAL: Record<string, string> = { gold: "🥇", silver: "🥈", bronze: "🥉" };

function tyreColor(score: number): string {
  if (score >= 80) return "var(--green)";
  if (score >= 50) return "var(--yellow)";
  return "var(--red)";
}

function BadgeCard({ badge }: { badge: BadgeDef }) {
  return (
    <div className={`badge-card${badge.roast ? " roast" : ""}`}>
      <div className="badge-head">
        <span className="badge-emoji">{badge.emoji}</span>
        <div>
          <div className="badge-label">{badge.label}</div>
          <div className="badge-hint">{badge.hint}</div>
        </div>
      </div>
      {badge.holders.length === 0 ? (
        <div className="badge-empty">Not enough logged sessions yet — keep testing.</div>
      ) : (
        <div className="badge-holders">
          {badge.holders.map((h) => (
            <div className="badge-holder" key={h.tier}>
              <span className="medal">{TIER_MEDAL[h.tier]}</span>
              <span className="holder-name">{h.driver_name}</span>
              <span className="holder-value">{h.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal bar chart — sessions logged per driver. */
function SessionsBarChart({ stats }: { stats: DriverStat[] }) {
  const max = Math.max(1, ...stats.map((d) => d.sessions_used));
  const rowH = 28;
  const width = 560;
  const barMax = width - 140;
  const height = stats.length * rowH + 8;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }}>
      {stats.map((d, i) => {
        const w = (d.sessions_used / max) * barMax;
        const y = i * rowH;
        return (
          <g key={d.driver_id}>
            <text x={0} y={y + rowH / 2 + 4} fontSize={12} fill="var(--text-muted)">
              {d.driver_name}
            </text>
            <rect x={120} y={y + 4} width={barMax} height={rowH - 12} rx={4} fill="var(--bg-active)" />
            <rect x={120} y={y + 4} width={w} height={rowH - 12} rx={4} fill="var(--accent)" />
            <text x={120 + barMax + 8} y={y + rowH / 2 + 4} fontSize={12} fill="var(--text-faint)">
              {d.sessions_used}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const LINE_COLORS = ["var(--accent)", "var(--teal)", "var(--purple)", "var(--yellow)", "var(--green)"];

/** Consistency-over-time trend lines for the top N drivers by sessions logged. */
function ConsistencyLineChart({ stats }: { stats: DriverStat[] }) {
  const top = stats.filter((d) => d.consistency_trend.length >= 2).slice(0, 5);
  const width = 560;
  const height = 220;
  const padL = 30;
  const padB = 20;
  const plotW = width - padL - 10;
  const plotH = height - padB - 10;

  const pathFor = (d: DriverStat) => {
    const pts = d.consistency_trend;
    return pts
      .map((p, i) => {
        const x = padL + (pts.length > 1 ? (i / (pts.length - 1)) * plotW : 0);
        const y = 10 + plotH - (p.consistency / 100) * plotH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  if (top.length === 0) {
    return <div className="badge-empty">Need at least 2 sessions each from a few drivers to plot a trend.</div>;
  }

  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block" }}>
        {[0, 25, 50, 75, 100].map((g) => {
          const y = 10 + plotH - (g / 100) * plotH;
          return (
            <g key={g}>
              <line x1={padL} y1={y} x2={width - 10} y2={y} stroke="var(--border-soft)" strokeWidth={1} />
              <text x={0} y={y + 4} fontSize={10} fill="var(--text-dim)">
                {g}
              </text>
            </g>
          );
        })}
        {top.map((d, i) => (
          <path key={d.driver_id} d={pathFor(d)} fill="none" stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} />
        ))}
      </svg>
      <div className="chart-legend">
        {top.map((d, i) => (
          <span key={d.driver_id} className="legend-item">
            <span className="legend-swatch" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
            {d.driver_name}
          </span>
        ))}
      </div>
    </>
  );
}

/** Per-driver tyre-wear gauge — a ring gauge coloured by the LMU tyre-phase palette. */
function TyreGauges({ stats }: { stats: DriverStat[] }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="tyre-gauge-grid">
      {stats.map((d) => {
        const pct = Math.max(0, Math.min(100, d.avg_tyre));
        const dash = (pct / 100) * c;
        return (
          <div className="tyre-gauge" key={d.driver_id}>
            <svg viewBox="0 0 80 80" width={80} height={80}>
              <circle cx={40} cy={40} r={r} fill="none" stroke="var(--bg-active)" strokeWidth={8} />
              <circle
                cx={40}
                cy={40}
                r={r}
                fill="none"
                stroke={tyreColor(pct)}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${c - dash}`}
                transform="rotate(-90 40 40)"
              />
              <text x={40} y={45} textAnchor="middle" fontSize={16} fontWeight={700} fill="var(--text)">
                {Math.round(pct)}
              </text>
            </svg>
            <div className="tyre-gauge-name">{d.driver_name}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function DriversPage() {
  const [stats, setStats] = useState<DriverStat[]>([]);
  const [badges, setBadges] = useState<BadgeDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .driverStats()
      .then((r) => {
        setStats(r.stats);
        setBadges(r.badges);
      })
      .finally(() => setLoading(false));
  }, []);

  const positive = badges.filter((b) => !b.roast);
  const roast = badges.filter((b) => b.roast);

  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>driver-board</h1>
        <span className="sub">friendly competition · {stats.length} driver{stats.length === 1 ? "" : "s"} logged this era</span>
      </div>
      <div className="content">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : stats.length === 0 ? (
          <div className="empty">
            <div className="big">🏁</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>No sessions logged yet</div>
            <div>Badges appear once a few drivers have logged sessions this era.</div>
          </div>
        ) : (
          <>
            <div className="card">
              <h2>Badges</h2>
              <div className="card-sub">Top 3 per badge, across every session logged this era. Needs 5+ sessions to qualify (Iron Man is the exception — that's the volume badge).</div>
              <div className="badge-grid">
                {positive.map((b) => (
                  <BadgeCard badge={b} key={b.id} />
                ))}
              </div>
            </div>

            <div className="card">
              <h2>Roast wall 🔥</h2>
              <div className="card-sub">All in good fun.</div>
              <div className="badge-grid">
                {roast.map((b) => (
                  <BadgeCard badge={b} key={b.id} />
                ))}
              </div>
            </div>

            <div className="card">
              <h2>Sessions logged</h2>
              <div className="card-sub">Who's putting in the seat time.</div>
              <SessionsBarChart stats={stats} />
            </div>

            <div className="card">
              <h2>Consistency over time</h2>
              <div className="card-sub">Top 5 most-active drivers, each session in order logged.</div>
              <ConsistencyLineChart stats={stats} />
            </div>

            <div className="card">
              <h2>Tyre care</h2>
              <div className="card-sub">Average Tyre factor — green is gentle, red is a tyre-eater.</div>
              <TyreGauges stats={stats} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
