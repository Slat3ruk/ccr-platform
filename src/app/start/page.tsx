"use client";

// ============================================================================
// Start here — the "how to USE the app" guide, for people opening it cold
// (drivers especially, on first access). Complements /scoring, which explains
// the maths: this one explains the DOING. Visible to all roles. Deliberately
// short — three questions: what is this, how do I log a run, how do I read it.
// ============================================================================

import Link from "next/link";

const STEPS: { n: number; title: string; body: React.ReactNode }[] = [
  {
    n: 1,
    title: "Run a test in-game",
    body: (
      <>
        Pick a car and track in Le Mans Ultimate and run a <strong>Practice</strong> session — a clean stint of laps
        (10–12 is ideal). Push at a realistic race pace, not a single hot lap. The more representative the run, the more
        the data is worth.
      </>
    ),
  },
  {
    n: 2,
    title: "Log it on #log-session",
    body: (
      <>
        Open <Link href="/log">#log-session</Link> and fill in the run: car, track, conditions, your lap times (paste
        them all if you can — it sharpens the consistency score), tyre wear at the end, off-tracks, and an honest{" "}
        <strong>confidence</strong> rating for how the car felt. The form sanity-checks as you go and flags anything that
        looks off.
      </>
    ),
  },
  {
    n: 3,
    title: "Read the board",
    body: (
      <>
        Your run instantly feeds the <Link href="/">#rankings</Link>. Pick a track and class to see which car the data
        favours, with a five-factor breakdown and a confidence score. The <Link href="/briefing">#briefing</Link> turns
        that into a plain "run this car" call for the next race.
      </>
    ),
  },
];

export default function StartPage() {
  return (
    <>
      <div className="topbar">
        <span className="hash">#</span>
        <h1>start-here</h1>
        <span className="sub">New to the app? Everything you need in three steps</span>
      </div>
      <div className="content content-narrow">
        <div className="card">
          <h2>What this is</h2>
          <div className="card-sub" style={{ marginBottom: 0 }}>
            A shared, data-driven answer to <strong>"which car should we run at this track?"</strong> Instead of gut
            feel, the team logs test runs and a transparent five-factor model ranks the cars per track and class. The
            more the team tests, the sharper every recommendation gets — so logging your runs genuinely helps everyone.
          </div>
        </div>

        <div className="card">
          <h2>How it works — three steps</h2>
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="row"
              style={{ alignItems: "flex-start", gap: 14, padding: "12px 0", borderTop: s.n === 1 ? "none" : "1px solid var(--border)" }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                }}
              >
                {s.n}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>{s.title}</div>
                <div className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
                  {s.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Good to know</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8 }}>
            <li>
              <strong style={{ color: "var(--text)" }}>Everyone can log.</strong> More data beats perfect data — a
              rough run still helps. The model already weights cleaner sessions higher, so just log honestly.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Nothing is hand-picked.</strong> Curious why a car ranks where it
              does? <Link href="/scoring">#how-scoring-works</Link> shows the exact maths behind every number.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>See where we're blind.</strong>{" "}
              <Link href="/coverage">#coverage</Link> maps which car/track combos still need testing — a great place to
              find a useful run to do.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>There's a leaderboard too.</strong>{" "}
              <Link href="/drivers">#driver-board</Link> ranks the testers for a bit of friendly competition — fastest,
              most consistent, most sessions logged.
            </li>
          </ul>
        </div>

        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Ready?</div>
          <div className="card-sub" style={{ marginBottom: 12 }}>Log your first run and put a car on the board.</div>
          <Link href="/log" className="btn" style={{ display: "inline-block" }}>
            Log a session →
          </Link>
        </div>
      </div>
    </>
  );
}
