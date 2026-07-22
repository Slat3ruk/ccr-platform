import { describe, expect, it } from "vitest";
import { MAX_TRACK_KM, parseLengthKm } from "./tracks";

describe("parseLengthKm", () => {
  it("treats absent/blank as null, not an error (the field is optional)", () => {
    for (const blank of [undefined, null, ""]) {
      expect(parseLengthKm(blank)).toEqual({ ok: true, value: null });
    }
  });

  it("accepts numbers and numeric strings", () => {
    expect(parseLengthKm(5.891)).toEqual({ ok: true, value: 5.891 });
    expect(parseLengthKm("13.626")).toEqual({ ok: true, value: 13.626 });
    expect(parseLengthKm("  4.909  ")).toEqual({ ok: true, value: 4.909 });
  });

  it("rounds to metres", () => {
    expect(parseLengthKm(5.8911111)).toEqual({ ok: true, value: 5.891 });
  });

  it("rejects non-numeric input", () => {
    for (const bad of ["abc", "5km", {}, true]) {
      expect(parseLengthKm(bad).ok).toBe(false);
    }
  });

  it("rejects zero and negatives", () => {
    expect(parseLengthKm(0).ok).toBe(false);
    expect(parseLengthKm(-3).ok).toBe(false);
  });

  it("rejects implausibly long laps (catches a metres-for-km typo)", () => {
    expect(parseLengthKm(MAX_TRACK_KM + 0.001).ok).toBe(false);
    expect(parseLengthKm(5891).ok).toBe(false); // metres entered by mistake
  });

  it("allows the longest real circuits", () => {
    expect(parseLengthKm(20.832).ok).toBe(true); // Nordschleife
    expect(parseLengthKm(13.626).ok).toBe(true); // Le Mans
  });
});
