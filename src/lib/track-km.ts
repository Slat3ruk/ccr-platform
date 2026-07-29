// ============================================================================
// Known LMU lap distances (km).
//
// SOURCES, best first. Nothing here is a looked-up-from-the-web number:
//   1. MEASURED — scoring shared memory's `track_length`, read live in-game.
//      The gold standard: it is what LMU actually simulates, which is not the
//      published figure. Laguna Seca measures 3590 m against a published
//      3.602 km — 12 m short, and that gap lands directly in fuel-per-lap.
//   2. The CCR stint planner's own `TRACKS` constant (ccr-v10.html), which the
//      team has used and trusted in anger for fuel/stint maths.
// Each entry below records which of the two it came from.
//
// ⚠ DO NOT ADD A TRACK HERE FROM A PUBLISHED LENGTH, however authoritative the
// source looks. Two circuits are deliberately ABSENT for exactly that reason:
//   • Daytona — the planner's TRACKS carries 5.734 but nobody can say where it
//     came from, and it has never been run in-game to check. Published road
//     course is ~5.729. The 5 m spread is the same order as the real
//     measured-vs-published gap, so it proves nothing. Stays null until someone
//     drives it (planner session, 2026-07-29: "I'd rather send you one
//     confirmed track than two with one silently unsourced").
//   • Every layout variant — see the note below.
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
  // MEASURED in-game from scoring `track_length` (source 1).
  // Laguna Seca: 3590 m, LMU 1.4, ~10 sessions on 2026-07-29, consistent every
  // time. The readout formats to the nearest metre, so the true value may be
  // 3590.x — don't treat the last digit as exact. LMU reports its name as
  // "WeatherTech Raceway Laguna Seca"; the short form here is the sheet's.
  "Laguna Seca": 3.59,

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
