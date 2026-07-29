// ============================================================================
// Known LMU lap distances (km).
//
// SOURCES, best first. Nothing here is a looked-up-from-the-web number:
//   1. MEASURED — scoring shared memory's `track_length`, read live in-game.
//      The gold standard: it is what LMU actually simulates, which is not the
//      published figure. Laguna Seca measures 3590 m against a published
//      3.602 km — 12 m short, on the same circuit in the same build.
//      Two circuits have now been measured and BOTH agree with the planner's
//      constant, so source 2 has a track record — see below.
//   2. The CCR stint planner's own `TRACKS` constant (ccr-v10.html), where the
//      value drives layout matching and a mismatch warning. ✅ VINDICATED
//      2026-07-29 on both circuits that have been measured: Laguna theirs 3.59
//      vs measured 3590 m; Daytona theirs 5.734 vs measured 5733.809 m. Neither
//      matches its published figure, so the table is NOT a spec sheet.
//      ⚠ I previously recorded the opposite here — reasoning that because most
//      of its values equal the official published length (Monza 5.793, Spa
//      7.004, Sarthe 13.626 …), the table had to be copied from one. Measurement
//      falsified that: sims and reality simply agree to three decimals most of
//      the time. Entries remain UNVERIFIED until measured, but do not assume
//      they are wrong, and never "correct" one toward its published figure.
//   3. LMU's own in-game TRACK INFO panel (the circuit splash: country, year
//      opened, length, turns). ⚠ RESOLVED 2026-07-29 — THESE PANELS REPORT
//      PUBLISHED SPEC, NOT SIMULATED LENGTH. Do not re-run this experiment:
//      the panel for Laguna Seca reads 3.602 km while scoring shared memory
//      measures 3590 m on the same circuit in the same build. So a source-3
//      figure is a real-world spec sheet with LMU's logo on it — better
//      sourced than a random web lookup, and useful for settling which LAYOUT
//      ships (turn counts and the name string are reliable), but its LENGTH is
//      wrong in BOTH DIRECTIONS depending on circuit — Laguna's panel is 12 m
//      long, Daytona's ~5 m short — so there is no correction factor to apply,
//      only measurement to wait for. Never take a length from here.
//
// ⚠ THE METHODOLOGICAL POINT, learned the hard way and worth keeping: after
// Laguna alone it was tempting to conclude "the sim runs ~0.3% shorter than
// published" and adjust the table. Daytona then measured LONGER than published.
// A one-circuit calibration curve would have been confidently wrong in the
// opposite direction. Two datapoints, opposite signs — measure each circuit,
// never extrapolate between them.
// Each entry below records which of the three it came from.
//
// ⚠ DO NOT ADD A TRACK HERE FROM A PUBLISHED WEB LENGTH. Layout variants stay
// deliberately absent for exactly that reason — see the note below.
//
// WHAT A WRONG LENGTH ACTUALLY BREAKS — corrected 2026-07-29 after the planner
// session checked rather than agreed. An earlier version of this comment said a
// long table would over-estimate fuel. **It would not: nothing computes fuel
// from lap distance in either app.** The planner measures fuel-per-lap from live
// fuel snapshots at each lap boundary, or the engineer types it in; `buildStrat`
// contains no reference to track length at all (verified by reading it). Here,
// `length_km` is reference data — carried in the CSV export, shown in the
// control panel, and nothing scores on it.
// So the real exposures are narrow, and worth knowing before anyone "fixes"
// this table under time pressure:
//   • The planner warns "this may be a different layout" when live
//     `track_length` differs from its constant by >50 m. A published-spec table
//     is fine on short circuits (Laguna's gap is 12 m) but Le Mans at 13.6 km
//     would be ~41 m on the same 0.3% — under the threshold, but not by much.
//     A published table plus a long circuit is how you'd get a spurious alarm.
//   • Layout tiebreaks are unaffected: a systematic offset shifts every
//     candidate equally, so the relative ordering still picks the right one.
//   • Future strategy work that DOES derive from distance would inherit the
//     error — which is the actual reason to keep this table honest.
//
// ⚠ DO NOT DERIVE A LENGTH FROM TRACKMAP GEOMETRY. Summing LMU's REST
// `watch/trackmap` type-0 centreline for Laguna gives 3551 m against a true
// 3590 — ~1% short, because a sampled polyline cuts every corner. The polyline
// is shape only; length comes from scoring.
//
// ⚠ BASE LAYOUTS ONLY. Every LMU circuit with layout variants — Bahrain
// (outer/paddock), Silverstone (International/National), Paul Ricard (1A/3A/…),
// Fuji (chicane/classic), Monza (curvagrande), Sarthe (straight), Qatar (short),
// Sebring (school), COTA (national) — has a genuinely different lap distance
// that is NOT recorded here, because a guessed figure that looks authoritative
// is worse than a visible blank. Those stay null and show as "no distance" in
// the control panel until someone reads the real value off scoring in-game.
// ============================================================================

/** Track name (as stored) → lap distance in km. Matched case/punctuation-insensitively. */
export const TRACK_KM: Record<string, number> = {
  // MEASURED in-game from scoring `track_length` (source 1) — and the reference
  // case that proved sources 1 and 3 disagree.
  // 3590 m, LMU 1.4, ~10 sessions on 2026-07-29, consistent every time. The
  // readout formats to the nearest metre, so the true value may be 3590.x —
  // don't treat the last digit as exact. LMU reports its name as "WeatherTech
  // Raceway Laguna Seca"; the short form here is the benchmark sheet's.
  // ⚠ LMU's own track info panel says 3.602 km for this circuit. That figure is
  // deliberately NOT used — it is the published spec, not what the sim runs, and
  // this 12 m disagreement is the evidence for the whole source ranking above.
  // If someone "corrects" this to 3.602, they have thrown away the one measured
  // datapoint the file has.
  "Laguna Seca": 3.59,

  // MEASURED in-game from the raw Scoring buffer (source 1), captured during a
  // live 62-car online race on 2026-07-29: `mLapDist` = **5733.809 m**, with
  // `mTrackName` = "Daytona International Speedway Road Course" — the name
  // string itself settles the layout, independently agreeing with the 13-turn
  // count on LMU's panel and the sheet's single no-variant "Daytona".
  //
  // ⚠ THIS REPLACED A PANEL FIGURE OF 5.729 THAT WAS WRONG IN THE OPPOSITE
  // DIRECTION TO EXPECTED. Laguna's panel runs 12 m LONG; Daytona's runs ~5 m
  // SHORT. The sign flips between circuits, which is why no blanket
  // published→measured correction is valid — see the header.
  //
  // Stored at metre precision (5733.809 → 5.734) deliberately: `parseLengthKm`
  // rounds every API write to 3 dp, so a 4 dp constant here would disagree with
  // the same track written through the control panel. 0.2 m is far below
  // anything that matters; one consistent value across all write paths is not.
  // It also lands exactly on the planner's own 5.734.
  Daytona: 5.734,

  // From the planner's TRACKS constant (source 2).
  "Circuit de la Sarthe": 13.626,
  Spa: 7.004,
  Monza: 5.793,
  Sebring: 6.019,
  Portimao: 4.653,
  Imola: 4.909,
  Interlagos: 4.309,
  COTA: 5.513,
  Barcelona: 4.655,
  Qatar: 5.38,
  "Paul Ricard": 5.842,
  "Silverstone (GP)": 5.891,
  "Bahrain (wec)": 5.412,
};

/** Same normalisation the benchmark sync uses: letters + digits only. */
function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_NORMALIZED = new Map(Object.entries(TRACK_KM).map(([name, km]) => [normalize(name), km]));

/**
 * Known lap distance for a stored track name, or null if we don't have a
 * trustworthy figure (which includes every layout variant — see the note above).
 */
export function knownTrackKm(name: string): number | null {
  return BY_NORMALIZED.get(normalize(name)) ?? null;
}
