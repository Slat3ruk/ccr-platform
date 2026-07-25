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

  // Regression: the cross-repo contract audit (2026-07-23) found race-ops' draft
  // ingest deriving ve_per_lap from LMU's 0..1 VE fraction while this app stores
  // a percentage. 0.028 passed >0 and <=100, so a burn 100x too low would have
  // been stored silently and then seeded strategy/priors.
  describe("VE fraction-vs-percentage guard", () => {
    it("rejects a fraction submitted where a percentage is meant", () => {
      for (const fraction of [0.028, 0.021, 0.1, 0.49]) {
        const r = validateSessionInput({ ...base, ve_per_lap: fraction });
        expect(r.valid, `${fraction} should be rejected`).toBe(false);
        expect(r.errors.join(" ")).toMatch(/fraction/i);
      }
    });

    it("names the actual mistake so the fix is obvious", () => {
      const r = validateSessionInput({ ...base, ve_per_lap: 0.028 });
      expect(r.errors.join(" ")).toMatch(/enter 2\.8 for 2\.8%/);
    });

    it("still accepts every realistic burn (LMU runs roughly 2-12 %/lap)", () => {
      for (const real of [0.5, 1.2, 2.8, 5, 9.4, 12, 100]) {
        expect(validateSessionInput({ ...base, ve_per_lap: real }).valid, `${real} should pass`).toBe(true);
      }
    });

    it("the guard is VE-only — fuel is litres, not a percentage", () => {
      // 0.4 L/lap is implausible too, but it is NOT the fraction bug and this
      // check must not start rejecting fuel values on VE's reasoning.
      expect(validateSessionInput({ ...base, fuel_per_lap: 0.4 }).valid).toBe(true);
    });
  });
});
