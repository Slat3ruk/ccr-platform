// ============================================================================
// Known LMU lap distances (km).
//
// SOURCES, best first. Nothing here is a looked-up-from-the-web number:
//   1. MEASURED — scoring shared memory's `track_length`, read live in-game.
//      The gold standard: it is what LMU actually simulates, which is not the
//      published figure. Laguna Seca measures 3590 m against a published
//      3.602 km — 12 m short, and that gap lands directly in fuel-per-lap.
//   2. The CCR stint planner's own `TRACKS` constant (ccr-v10.html), which the
//      team has used in anger for fuel/stint maths. ⚠ SUSPECTED to be published
//      spec too, i.e. no better than source 3 — every value imported from it is
//      *exactly* the circuit's official figure (Monza 5.793, Spa 7.004, Sarthe
//      13.626, Silverstone 5.891 …), none has the awkward last digit a measured
//      value tends to, and the planner session said of its Daytona entry: "it
//      may well be a published figure someone typed in". Not proven, and cheap
//      to settle: compare live scoring `track_length` against this table next
//      time anyone drives one of them. If they diverge, assume every source-2
//      entry runs ~0.3% long, always in the same direction (over-estimating
//      distance ⇒ over-estimating fuel).
//   3. LMU's own in-game TRACK INFO panel (the circuit splash: country, year
//      opened, length, turns). ⚠ RESOLVED 2026-07-29 — THESE PANELS REPORT
//      PUBLISHED SPEC, NOT SIMULATED LENGTH. Do not re-run this experiment:
//      the panel for Laguna Seca reads 3.602 km while scoring shared memory
//      measures 3590 m on the same circuit in the same build. So a source-3
//      figure is a real-world spec sheet with LMU's logo on it — better
//      sourced than a random web lookup, and useful for settling which LAYOUT
//      ships (turn counts are reliable), but it runs LONG by roughly 0.3% and
//      must be superseded by scoring `track_length` once anyone drives there.
// Each entry below records which of the three it came from.
//
// ⚠ DO NOT ADD A TRACK HERE FROM A PUBLISHED WEB LENGTH. Layout variants stay
// deliberately absent for exactly that reason — see the note below.
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
// that is NOT recorded here, because guessing reference data that later feeds
// fuel calculations is worse than leaving it blank. Those stay null and show as
// "no distance" in the control panel until someone enters the real figure
// (easiest read straight off the in-game HUD).
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
  // WRONG for our purposes and is deliberately not used: 12 m of difference on
  // every lap, straight into fuel-per-lap. If someone "corrects" this to 3.602,
  // they have reintroduced the exact bug this file exists to prevent.
  "Laguna Seca": 3.59,

  // From LMU's in-game track info panel (source 3), screenshotted by the user
  // 2026-07-29: "Daytona Beach, FL, USA · Opened 1959 · 5.729 km · 13 turns ·
  // Le Mans Ultimate - US Track Pack 1". The 13 turns are the valuable part —
  // they confirm the ROAD COURSE rather than the 4.023 km oval, matching the
  // benchmark sheet, which created a single "Daytona" with no layout variants.
  //
  // ⚠ PROVISIONAL AND KNOWN TO RUN LONG. Source 3 is now confirmed to be
  // published spec (see the header): the same panel reads 3.602 for Laguna
  // where scoring measures 3590. Expect Daytona's simulated length to come in
  // BELOW 5.729 — around 5.71 if the ~0.3% Laguna gap is representative, though
  // one circuit is not a calibration curve, so no correction is applied here.
  // Replace with scoring `track_length` the first time anyone drives it.
  // Still better sourced than the planner's unexplained 5.734, which it
  // supersedes.
  Daytona: 5.729,

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
