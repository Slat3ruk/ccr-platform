// ============================================================================
// LMU lap distances (km) — ALL MEASURED.
//
// SOURCE: scoring shared memory's `track_length`, captured by the CCR stint
// planner while each circuit was loaded in LMU, then exported from its Debrief
// tab. Every value below came from that one sweep (2026-08-01, 32 layouts).
// Nothing here is a published figure, a web lookup, or LMU's own info panel.
//
// The raw export is archived alongside the seed data at
// `src/data/CCR_Layouts_2026-08-01.json` — unused by code, kept so this table
// can be RE-VERIFIED rather than trusted. It maps LMU's own `mTrackName` to the
// measured length; the sheet's shorter names below are the mapping. To check the
// table, compare each entry against that file (a mismatch means a transcription
// error, not a new measurement).
//
// ⚠ THE TWO SOURCES WE DO NOT USE, AND WHY — both were tested, not assumed:
//   • LMU's in-game TRACK INFO panel (the circuit splash) reports PUBLISHED
//     SPEC. Proven: it reads 3.602 km for Laguna where scoring measures 3590 m,
//     and 5.729 for Daytona where scoring measures 5733.8 m. Note it is wrong in
//     BOTH directions — 12 m long, then 5 m short — so there is no correction
//     factor to derive, only measurement. Turn counts and the name string on
//     that panel ARE reliable and are good for identifying which layout ships.
//   • Trackmap geometry. Summing LMU's REST `watch/trackmap` type-0 centreline
//     for Laguna gives 3551 m against a true 3590 — ~1% short, because a sampled
//     polyline cuts every corner. Shape only; never length.
//
// ⚠ METHODOLOGICAL NOTE — the mistake this file exists to prevent, made and
// caught during its own construction. These values previously came from the
// stint planner's `TRACKS` constant. I suspected that constant was a spec sheet
// (its values matched official published lengths exactly), then RETRACTED that
// suspicion when Laguna and Daytona were measured and both agreed with it.
// The full sweep settled it: **12 of those 15 inherited values were wrong**, by
// 8 m to 199 m (Sebring: 6.019 inherited vs 5.820 measured). The original
// suspicion was correct. The retraction was SAMPLING BIAS — Laguna and Daytona
// are the two newest entries in that constant, added carefully and evidently
// from measurement, so they were the least representative rows in the table.
// Two agreeing datapoints felt like confirmation and were nothing of the kind.
// ⇒ Do not re-derive an entry here from any non-measured source, and do not
//   treat agreement between a couple of entries as validating a whole table.
//
// ⚠ ADDING A NEW CIRCUIT: load it in LMU (a practice session is enough — lap
// length is a static property of the loaded track, no driving required), let the
// session settle, confirm the on-screen track name matches what you loaded, then
// export from the planner's Debrief tab. The SHM map opens mid-load and persists
// after leaving a server, so a hurried read can report the PREVIOUS circuit.
// ============================================================================

/**
 * Track name (as stored, i.e. the Ohne Speed sheet's) → measured lap distance in
 * km. Matched case/punctuation-insensitively, so LMU's own longer names resolve.
 * Values are 3 dp because `parseLengthKm` rounds every API write to the metre —
 * a finer constant here would disagree with the same track edited in the UI.
 */
export const TRACK_KM: Record<string, number> = {
  // ── Bahrain ─────────────────────────────────────────────────────────────
  "Bahrain (wec)": 5.387, // LMU "Bahrain International Circuit"
  "Bahrain (endurance)": 6.257, // LMU "Bahrain Endurance Circuit"
  "Bahrain (outer)": 3.511, // LMU "Bahrain Outer Circuit"
  "Bahrain (paddock)": 3.811, // LMU "Bahrain Paddock Circuit"

  // ── Circuit de la Sarthe ────────────────────────────────────────────────
  "Circuit de la Sarthe": 13.624,
  // ⚠ MAPPED BY ELIMINATION, not by name. LMU offers exactly two Sarthe
  // layouts — "Circuit de la Sarthe" (13.624) and "…Mulsanne" (13.561) — and the
  // sheet has exactly two. The base names match exactly, so "(straight)" must be
  // Mulsanne. Corroborated physically: removing the Mulsanne chicanes shortens
  // the lap, and 13.561 < 13.624.
  "Circuit de la Sarthe (straight)": 13.561,

  // ── Silverstone ─────────────────────────────────────────────────────────
  "Silverstone (GP)": 5.869, // LMU "Silverstone Grand Prix Circuit - WEC"
  "Silverstone (International)": 2.962,
  "Silverstone (National)": 2.634,

  // ── Paul Ricard ─────────────────────────────────────────────────────────
  "Paul Ricard": 5.807, // LMU "Paul Ricard - ELMS" — the sheet's base entry
  "Paul Ricard (1A)": 5.699,
  "Paul Ricard (1A v2)": 5.758,
  "Paul Ricard (1A v2 short)": 5.162,
  "Paul Ricard (3A)": 3.752,

  // ── Fuji ────────────────────────────────────────────────────────────────
  // ⚠ MAPPED BY ELIMINATION, as with Sarthe. LMU has "Fuji Speedway" (4.536) and
  // "Fuji Speedway Classic" (4.502); the sheet has "(chicane)" and "(classic)".
  // Classic matches by name, so chicane is the plain one. Corroborated
  // physically: the chicane layout is the longer of the two, and 4.536 > 4.502.
  "Fuji (chicane)": 4.536,
  "Fuji (classic)": 4.502,

  // ── Monza ───────────────────────────────────────────────────────────────
  Monza: 5.781, // LMU "Autodromo Nazionale Monza"
  "Monza (curvagrande)": 5.745, // LMU "Monza Curva Grande Circuit"

  // ── Qatar ───────────────────────────────────────────────────────────────
  Qatar: 5.405, // LMU "Lusail International Circuit"
  "Qatar (short)": 3.676, // LMU "Lusail Short Circuit"

  // ── Sebring ─────────────────────────────────────────────────────────────
  // ⚠ The single biggest correction in the sweep: the inherited value was 6.019
  // (the official published length), and LMU actually simulates 5.820 — 199 m
  // shorter. If anyone "fixes" this back toward the published figure, they are
  // undoing a measurement.
  Sebring: 5.82,
  "Sebring (school)": 3.083,

  // ── COTA ────────────────────────────────────────────────────────────────
  COTA: 5.497, // LMU "Circuit of the Americas"
  "COTA (national)": 3.707,

  // ── Single-layout circuits ──────────────────────────────────────────────
  Spa: 6.982, // LMU "Circuit de Spa-Francorchamps"
  Imola: 4.901, // LMU "Autodromo Enzo e Dino Ferrari"
  Interlagos: 4.273, // LMU "Autódromo José Carlos Pace"
  Barcelona: 4.655, // LMU "Circuit de Barcelona"
  Portimao: 4.635, // LMU "Algarve International Circuit"
  Daytona: 5.734, // LMU "Daytona International Speedway Road Course" (5733.809 m)
  "Laguna Seca": 3.59, // LMU "WeatherTech Raceway Laguna Seca" (3590 m)
};

/**
 * Layouts LMU ships that the Ohne Speed sheet does NOT list, so they have no
 * track row to attach to. Recorded so the next sweep doesn't think they were
 * missed — add them to TRACK_KM if the sheet ever gains them.
 *   • "Circuit de Spa-Francorchamps Endurance" — 6.982, identical to Spa.
 */

/** Same normalisation the benchmark sync uses: letters + digits only. */
function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_NORMALIZED = new Map(Object.entries(TRACK_KM).map(([name, km]) => [normalize(name), km]));

/**
 * Measured lap distance for a stored track name, or null if we have not measured
 * it. Null shows as "no distance" in the control panel — the honest state.
 */
export function knownTrackKm(name: string): number | null {
  return BY_NORMALIZED.get(normalize(name)) ?? null;
}
