import { describe, expect, it } from "vitest";
import { csvCell, SESSION_CSV_COLUMNS, sessionsToCsv, type CsvLookups } from "./csv";
import type { Session } from "@/types";

const look: CsvLookups = {
  driverName: () => "Dal",
  carName: () => "Ferrari 499P",
  carClass: () => "Hypercar",
  trackName: () => "Imola",
  trackKm: () => 4.909,
};

const session = {
  id: 1,
  driver_id: 1,
  car_id: 1,
  track_id: 1,
  session_type: "Practice",
  condition_reported: "Dry",
  patch_version: "1.3.3.4",
  lap_count: 12,
  best_lap_time: 102.318,
  avg_lap_time: 103.502,
  off_track_count: 1,
  off_track_penalty_points: 0,
  confidence_rating: 7,
  setup_type: "Race Safe",
  setup_version: "1.3.3",
  comments: "Understeer on entry",
  lap_times: null,
  fuel_per_lap: 3.42,
  ve_per_lap: 2.85,
  session_value_score: 81.5,
  value_components: null,
  created_at: "2026-07-22T10:00:00.000Z",
  updated_at: "2026-07-22T10:00:00.000Z",
  tyres: {
    tyre_fl_pct_remaining: 80,
    tyre_fr_pct_remaining: 78,
    tyre_rl_pct_remaining: 82,
    tyre_rr_pct_remaining: 81,
    avg_wear_pct: 19.75,
  },
} as unknown as Session;

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("Imola")).toBe("Imola");
    expect(csvCell(12)).toBe("12");
  });

  it("blanks null/undefined rather than writing 'null'", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and escapes the things that break spreadsheets", () => {
    // A driver comment is the realistic source of all three.
    expect(csvCell("understeer, then snap")).toBe('"understeer, then snap"');
    expect(csvCell('he said "loose"')).toBe('"he said ""loose"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });
});

describe("sessionsToCsv", () => {
  it("emits the header then one row per session", () => {
    const csv = sessionsToCsv([session, session], look);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(SESSION_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
  });

  it("carries the fields a spreadsheet actually needs", () => {
    const row = sessionsToCsv([session], look).trimEnd().split("\r\n")[1];
    expect(row).toContain("Dal");
    expect(row).toContain("Ferrari 499P");
    expect(row).toContain("Imola");
    expect(row).toContain("4.909"); // track km
    expect(row).toContain("1:42.318"); // readable best lap
    expect(row).toContain("102.318"); // and the raw seconds, for maths
    expect(row).toContain("3.42"); // fuel/lap
    expect(row).toContain("2.85"); // VE/lap
  });

  it("a comment with a comma can't shift the columns", () => {
    const s = { ...session, comments: "understeer, then snap" } as Session;
    const row = sessionsToCsv([s], look).trimEnd().split("\r\n")[1];
    // Count only unquoted commas by stripping quoted spans first.
    const unquoted = row.replace(/"(?:[^"]|"")*"/g, "");
    expect(unquoted.split(",").length - 1).toBe(SESSION_CSV_COLUMNS.length - 1);
  });

  it("handles an empty set without crashing (header only)", () => {
    expect(sessionsToCsv([], look).trimEnd()).toBe(SESSION_CSV_COLUMNS.join(","));
  });
});
