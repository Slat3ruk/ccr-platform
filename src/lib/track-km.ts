// ============================================================================
// Known LMU lap distances (km).
//
// SOURCE: the CCR stint planner's own `TRACKS` constant (ccr-v10.html), which
// the team has used and trusted in anger for fuel/stint maths. These are NOT
// looked-up-from-the-web numbers.
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
