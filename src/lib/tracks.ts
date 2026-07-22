// ============================================================================
// Track reference-data helpers. Lap distance is optional everywhere (tracks
// auto-created by the benchmark sync have none), so parsing has to treat
// "absent" and "invalid" as different answers.
// ============================================================================

/** Longest real circuit is the Nordschleife at ~20.8 km; Le Mans ~13.6. */
export const MAX_TRACK_KM = 30;

export type ParsedLength = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Normalise a submitted lap distance.
 * - `undefined` / `null` / `""` → `null` (field left blank, which is allowed)
 * - a positive number ≤ MAX_TRACK_KM → that number, rounded to 3 dp (metres)
 * - anything else → an error message for a 400
 */
export function parseLengthKm(raw: unknown): ParsedLength {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };

  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { ok: false, error: "Track length must be a number (km)." };
  if (n <= 0) return { ok: false, error: "Track length must be greater than 0 km." };
  if (n > MAX_TRACK_KM) {
    return { ok: false, error: `Track length looks wrong — ${n} km is longer than any real circuit (max ${MAX_TRACK_KM}).` };
  }
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}
