import { describe, expect, it } from "vitest";
import { validateSessionInput } from "./validation";

/** A minimal payload that already validates — tests vary one field at a time. */
const base = {
  driver_name: "Dal",
  car_id: 1,
  track_id: 1,
  session_type: "Practice",
  condition_reported: "Dry",
  lap_count: 12,
  best_lap_time: 102.318,
  avg_lap_time: 103.502,
  off_track_count: 0,
  confidence_rating: 7,
  tyre_fl_pct_remaining: 80,
  tyre_fr_pct_remaining: 80,
  tyre_rl_pct_remaining: 80,
  tyre_rr_pct_remaining: 80,
};

describe("validateSessionInput — consumption fields", () => {
  it("the base payload is valid (guards the fixture itself)", () => {
    expect(validateSessionInput(base).valid).toBe(true);
  });

  it("both fields are optional — absent or blank is fine", () => {
    for (const v of [undefined, null, ""]) {
      const r = validateSessionInput({ ...base, fuel_per_lap: v, ve_per_lap: v });
      expect(r.valid).toBe(true);
      expect(r.data?.fuel_per_lap).toBeUndefined();
      expect(r.data?.ve_per_lap).toBeUndefined();
    }
  });

  it("accepts sensible values and keeps 3 dp", () => {
    const r = validateSessionInput({ ...base, fuel_per_lap: 3.4567, ve_per_lap: 2.8 });
    expect(r.valid).toBe(true);
    expect(r.data?.fuel_per_lap).toBe(3.457);
    expect(r.data?.ve_per_lap).toBe(2.8);
  });

  it("rejects non-numeric and non-positive fuel", () => {
    for (const bad of ["abc", 0, -1]) {
      expect(validateSessionInput({ ...base, fuel_per_lap: bad }).valid).toBe(false);
    }
  });

  it("rejects an implausible fuel figure (a per-stint total typed as per-lap)", () => {
    const r = validateSessionInput({ ...base, fuel_per_lap: 60 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/30 L\/lap/);
  });

  it("rejects VE over 100% or non-positive", () => {
    expect(validateSessionInput({ ...base, ve_per_lap: 101 }).valid).toBe(false);
    expect(validateSessionInput({ ...base, ve_per_lap: 0 }).valid).toBe(false);
    expect(validateSessionInput({ ...base, ve_per_lap: "x" }).valid).toBe(false);
  });

  it("a bad consumption value doesn't silently drop — it fails the whole submit", () => {
    const r = validateSessionInput({ ...base, fuel_per_lap: -5 });
    expect(r.valid).toBe(false);
    expect(r.data).toBeUndefined();
  });
});
