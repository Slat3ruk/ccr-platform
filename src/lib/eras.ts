// ============================================================================
// Era helpers — pure functions over the era list ("lines in the sand").
// An era owns every session whose created_at falls in [starts_at, next era's
// starts_at). With no eras defined there is one implicit era covering all data,
// so the app behaves exactly as it did before eras existed. Eras whose
// starts_at is in the future are ignored until reached.
// ============================================================================

import type { Era } from "@/types";

/** Eras sorted oldest-first by starts_at (ties by id). */
export function sortEras(eras: Era[]): Era[] {
  return [...eras].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id - b.id,
  );
}

/**
 * The era in effect at `nowMs`: the latest era whose starts_at has passed.
 * Null = the implicit "all data" era (none defined, or none started yet).
 */
export function currentEra(eras: Era[], nowMs: number): Era | null {
  const started = sortEras(eras).filter((e) => Date.parse(e.starts_at) <= nowMs);
  return started.length ? started[started.length - 1] : null;
}

export interface EraRange {
  /** Inclusive lower bound (ms). -Infinity for the implicit pre-era span. */
  fromMs: number;
  /** Exclusive upper bound (ms). +Infinity for the newest era. */
  toMs: number;
}

/**
 * The time range a given era covers. `eraId = null` means the implicit span
 * before the first era (or all time when no eras exist). Returns null for an
 * unknown id.
 */
export function eraRange(eras: Era[], eraId: number | null): EraRange | null {
  const sorted = sortEras(eras);
  if (eraId == null) {
    return { fromMs: -Infinity, toMs: sorted.length ? Date.parse(sorted[0].starts_at) : Infinity };
  }
  const idx = sorted.findIndex((e) => e.id === eraId);
  if (idx === -1) return null;
  return {
    fromMs: Date.parse(sorted[idx].starts_at),
    toMs: idx + 1 < sorted.length ? Date.parse(sorted[idx + 1].starts_at) : Infinity,
  };
}

/** The range live rankings should score: the current era at `nowMs`. */
export function currentEraRange(eras: Era[], nowMs: number): EraRange {
  const era = currentEra(eras, nowMs);
  if (!era) {
    // No era in effect: score everything (pre-era behaviour). Note the upper
    // bound stays open — a future-dated era doesn't hide today's sessions.
    return { fromMs: -Infinity, toMs: Infinity };
  }
  // The current era always extends forward to now (future-dated eras are not
  // in effect yet), so the range is open-ended.
  return { fromMs: Date.parse(era.starts_at), toMs: Infinity };
}

/** True when `createdAtMs` falls inside `range`. */
export function inRange(createdAtMs: number, range: EraRange): boolean {
  return createdAtMs >= range.fromMs && createdAtMs < range.toMs;
}
