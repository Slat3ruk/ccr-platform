import { describe, expect, it } from "vitest";
import { sessionQualityWarnings } from "./quality";

const bench = { alien_time: 100, offline_time: 110 };
const clean = { best_lap_time: 103, avg_lap_time: 104, lap_count: 12, avg_wear_pct: 18, lap_times_count: null };

describe("sessionQualityWarnings", () => {
  it("returns nothing for a clean, plausible session", () => {
    expect(sessionQualityWarnings(clean, bench)).toEqual([]);
  });

  it("flags a best lap quicker than the alien tier", () => {
    const w = sessionQualityWarnings({ ...clean, best_lap_time: 99 }, bench);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/quicker than the alien/i);
  });

  it("flags a best lap slower than the slowest tier", () => {
    const w = sessionQualityWarnings({ ...clean, best_lap_time: 111, avg_lap_time: 112 }, bench);
    expect(w[0]).toMatch(/slower than the slowest/i);
  });

  it("skips the pace bracket when no benchmark is known", () => {
    expect(sessionQualityWarnings({ ...clean, best_lap_time: 99 }, null)).toEqual([]);
  });

  it("flags no tyre wear over a real stint, but not a short run", () => {
    expect(sessionQualityWarnings({ ...clean, avg_wear_pct: 0, lap_count: 12 }, bench)).toHaveLength(1);
    expect(sessionQualityWarnings({ ...clean, avg_wear_pct: 0, lap_count: 4 }, bench)).toEqual([]);
  });

  it("flags a lap-times count that disagrees with the lap count", () => {
    const w = sessionQualityWarnings({ ...clean, lap_count: 12, lap_times_count: 10 }, bench);
    expect(w[0]).toMatch(/10 individual lap times but set the lap count to 12/);
  });

  it("does not flag matching lap-times count", () => {
    expect(sessionQualityWarnings({ ...clean, lap_count: 10, lap_times_count: 10 }, bench)).toEqual([]);
  });

  it("flags an average far slower than the best over a real run", () => {
    const w = sessionQualityWarnings({ ...clean, best_lap_time: 100, avg_lap_time: 120, lap_count: 8 }, bench);
    expect(w.some((m) => /slower than the best/i.test(m))).toBe(true);
  });

  it("flags a setup built on an older patch than the session's", () => {
    const w = sessionQualityWarnings({ ...clean, setup_version: "1.2.9", patch_version: "1.3.4" }, bench);
    expect(w.some((m) => /Setup patch \(1\.2\.9\) is older/i.test(m))).toBe(true);
  });

  it("does not flag a current-patch setup or unparseable versions", () => {
    expect(sessionQualityWarnings({ ...clean, setup_version: "1.3.4", patch_version: "1.3.4" }, bench)).toEqual([]);
    expect(sessionQualityWarnings({ ...clean, setup_version: "GMR001", patch_version: "1.3.4" }, bench)).toEqual([]);
  });
});
