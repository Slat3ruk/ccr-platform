// ============================================================================
// CSV export of logged sessions. A human-readable season archive that doesn't
// depend on Postgres being restorable — complements pg_dump rather than
// replacing it (a dump is authoritative; this opens in Excel).
// ============================================================================

import type { Session } from "@/types";

/**
 * Quote a CSV field. Excel/Sheets need doubling of internal quotes, and any
 * field containing a comma, quote or newline must be wrapped — driver comments
 * routinely contain all three.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Seconds → M:SS.mmm, matching how lap times are shown in the UI. */
function lapTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

export const SESSION_CSV_COLUMNS = [
  "session_id",
  "logged_at",
  "driver",
  "car",
  "car_class",
  "track",
  "track_km",
  "session_type",
  "condition",
  "patch",
  "laps",
  "best_lap",
  "best_lap_seconds",
  "avg_lap",
  "avg_lap_seconds",
  "off_tracks",
  "confidence",
  "setup_type",
  "setup_patch",
  "fuel_per_lap_l",
  "ve_per_lap_pct",
  "tyre_fl_pct",
  "tyre_fr_pct",
  "tyre_rl_pct",
  "tyre_rr_pct",
  "avg_wear_pct",
  "session_value_score",
  "comments",
] as const;

export interface CsvLookups {
  driverName(id: number): string;
  carName(id: number): string;
  carClass(id: number): string;
  trackName(id: number): string;
  trackKm(id: number): number | null;
}

/** One CSV row per session, in SESSION_CSV_COLUMNS order. */
export function sessionToCsvRow(s: Session, look: CsvLookups): string {
  const cells: unknown[] = [
    s.id,
    s.created_at,
    look.driverName(s.driver_id),
    look.carName(s.car_id),
    look.carClass(s.car_id),
    look.trackName(s.track_id),
    look.trackKm(s.track_id) ?? "",
    s.session_type,
    s.condition_reported,
    s.patch_version ?? "",
    s.lap_count,
    lapTime(s.best_lap_time),
    s.best_lap_time,
    lapTime(s.avg_lap_time),
    s.avg_lap_time,
    s.off_track_count,
    s.confidence_rating,
    s.setup_type ?? "",
    s.setup_version ?? "",
    s.fuel_per_lap ?? "",
    s.ve_per_lap ?? "",
    s.tyres?.tyre_fl_pct_remaining ?? "",
    s.tyres?.tyre_fr_pct_remaining ?? "",
    s.tyres?.tyre_rl_pct_remaining ?? "",
    s.tyres?.tyre_rr_pct_remaining ?? "",
    s.tyres?.avg_wear_pct ?? "",
    s.session_value_score ?? "",
    s.comments ?? "",
  ];
  return cells.map(csvCell).join(",");
}

/** Full CSV document (header + rows), CRLF-terminated for Excel. */
export function sessionsToCsv(sessions: Session[], look: CsvLookups): string {
  const lines = [SESSION_CSV_COLUMNS.join(",")];
  for (const s of sessions) lines.push(sessionToCsvRow(s, look));
  return lines.join("\r\n") + "\r\n";
}
