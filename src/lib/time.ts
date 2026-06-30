// ============================================================================
// Lap-time parsing / formatting.  The UI works in "M:SS.mmm" strings; the
// store and scoring engine work in float seconds.
// ============================================================================

/**
 * Parse a lap time into seconds. Accepts:
 *   "3:47.123"  → 227.123
 *   "1:23.4"    → 83.4
 *   "47.123"    → 47.123   (no minutes)
 *   "227.123"   → 227.123  (already seconds)
 * Returns null if it cannot be parsed.
 */
export function parseLapTime(input: string | number): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? input : null;
  const raw = String(input).trim();
  if (!raw) return null;

  if (raw.includes(":")) {
    const parts = raw.split(":");
    if (parts.length !== 2) return null;
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs < 0 || secs >= 60) return null;
    const total = mins * 60 + secs;
    return total > 0 ? total : null;
  }

  const secs = Number(raw);
  return Number.isFinite(secs) && secs > 0 ? secs : null;
}

/** Format seconds as "M:SS.mmm" (e.g., 227.123 → "3:47.123"). */
export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const secStr = secs.toFixed(3).padStart(6, "0"); // "07.123"
  return `${mins}:${secStr}`;
}
