"use client";

// ============================================================================
// How scoring works — the transparency page. When a driver asks "why is my
// session worth less than his?", this page (and the SVS breakdown tooltips on
// the session log) answers instead of an argument. Everything here documents
// the REAL constants in src/lib/scoring.ts — update both together.
// Visible to ALL roles incl. drivers (user call, 2026-07-05 — transparency is
// the point).
// ============================================================================

const FACTOR_ROWS: { name: string; weight: string; what: string; how: string }[] = [
  {
    name: "Pace",
    weight: "35%",
    what: "How fast the car is in this driver's hands",
    how: "Best lap vs the Ohne Speed benchmark tiers: quicker than Alien = 100, then Competitive 95, Good 85, Midpack 70, sliding down toward Tail-ender. No benchmark → neutral 50.",
  },
  {
    name: "Consistency",
    weight: "25%",
    what: "Can it do that lap again and again",
    how: "Lap-time spread in absolute seconds: 0 s spread = 100, a 2 s spread = 50. Uses the true lap-by-lap std-dev when individual laps were pasted, otherwise the best→average gap. Obvious out-laps/traffic laps are excluded.",
  },
  {
    name: "Tyre",
    weight: "15%",
    what: "How gentle the car is on rubber",
    how: "Average wear across the four tyres, scaled by run length. Comparative — there's no 'ideal' wear rate, cars are ranked against each other.",
  },
  {
    name: "Drivability",
    weight: "15%",
    what: "How confident the driver felt",
    how: "Your 1–10 confidence slider × 10. The one subjective input, on purpose — a car you trust is worth something the stopwatch can't see.",
  },
  {
    name: "Mistakes",
    weight: "10%",
    what: "How forgiving the car is",
    how: "Off-track count normalised to run length — 3+ offs in a 10–15 lap run ≈ 0, a clean run = 100.",
  },
];

const SVS_ROWS: { name: string; weight: string; how: string }[] = [
  { name: "Completeness", weight: "30%", how: "Lap count — a 15-lap run says far more than a 3-lap dash." },
  { name: "Consistency", weight: "25%", how: "Same spread measure as the factor — messy sessions carry less signal." },
  { name: "Cleanliness", weight: "20%", how: "Off-tracks relative to run length." },
  {
    name: "Representativeness",
    weight: "15%",
    how: "Race/Practice = 100, Quali hotlap = 90; Dry ×1.0, Mixed ×0.95, Wet ×0.9. A setup built on an OLDER patch than the session's multiplies this by 0.7.",
  },
  { name: "Recency", weight: "10%", how: "Full weight inside 7 days, sliding to 40 at 30 days, then a slow decay to a floor of 10." },
];

export default function ScoringPage() {
  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>how-scoring-works</h1>
        <span className="sub">The maths behind every number on the board — nothing is hand-picked</span>
      </div>
      <div className="content content-narrow">
        <div className="card">
          <h2>The one-paragraph version</h2>
          <div className="card-sub" style={{ marginBottom: 0 }}>
            Every logged session is scored on <strong>five factors</strong> (0–100 each). A car's score at a track is the
            weighted blend of its latest <strong>10 sessions</strong> for that track, class and condition — but sessions
            don't count equally: each one carries a <strong>Session Value Score</strong> (SVS), so a clean 15-lap run
            outweighs a scrappy 3-lap dash. Only sessions from the <strong>current patch</strong> count toward the live
            board (older patches stay viewable in the archive). No human picks the order — change the inputs and the
            board changes.
          </div>
        </div>

        <div className="card">
          <h2>The five factors → Car Score</h2>
          <div className="card-sub">
            Weights shown are the <strong>Balanced</strong> team default. Presets shift them (Pace-focused 50/20/10/10/10 ·
            Tyre-saver 25/25/30/10/10 · Sprint 40/20/5/15/20) and your personal lens re-ranks with any preset without
            touching anyone else's view.
          </div>
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th className="num">Weight</th>
                  <th>Measures</th>
                  <th>How it's scored</th>
                </tr>
              </thead>
              <tbody>
                {FACTOR_ROWS.map((f) => (
                  <tr key={f.name}>
                    <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{f.name}</td>
                    <td className="num">{f.weight}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{f.what}</td>
                    <td className="muted" style={{ fontSize: 13 }}>{f.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Session Value Score — why sessions aren't equal</h2>
          <div className="card-sub">
            Each session gets a 0–100 SVS from five components; that SVS is its <em>weight</em> when sessions are blended
            into the Car Score. Hover the SVS column on <a href="/sessions">#session-log</a> to see any session's
            breakdown.
          </div>
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="num">Weight</th>
                  <th>How it's scored</th>
                </tr>
              </thead>
              <tbody>
                {SVS_ROWS.map((r) => (
                  <tr key={r.name}>
                    <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{r.name}</td>
                    <td className="num">{r.weight}</td>
                    <td className="muted" style={{ fontSize: 13 }}>{r.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Confidence — how much to trust a score</h2>
          <div className="card-sub" style={{ marginBottom: 0 }}>
            Confidence = <strong>volume × quality</strong>. Volume follows n/(n+1) — one session ≈ 50%, three ≈ 75%,
            more keeps helping with diminishing returns, no hard cap. Quality is the average SVS of the sessions used. So
            "82 score · 31% confidence" means: promising, but thin evidence — log more runs and the confidence climbs.
          </div>
        </div>

        <div className="card">
          <h2>Patches, benchmarks &amp; guardrails</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
            <li>
              <strong style={{ color: "var(--text)" }}>Patch scoping:</strong> a version, update, or patch bump draws a
              line — the live board only scores sessions logged after it. Hotfixes (the 4th number, e.g. 1.3.3.
              <strong>4</strong>) usually just relabel. Every session is stamped with the patch it was logged under.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Stale setups:</strong> a session run on a setup built for an older
              patch keeps counting, but its representativeness is cut to 70% — and it's flagged ⚠ in the log.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Benchmarks:</strong> dry pace tiers come from the public Ohne
              Speed sheet (synced on demand). Wet tiers are derived as dry × (1 + penalty) — global % with per-track
              overrides where circuits deviate.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Quality flags:</strong> suspect sessions (faster than the alien
              tier, zero wear over a long run, lap counts that disagree…) get a ⚠ and a confirm at log time — never
              blocked, always visible.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Best setup:</strong> a setup needs 3+ runs before it can be named
              a car's best; fewer and the car shows a blend.
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
