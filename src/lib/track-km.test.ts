import { describe, expect, it } from "vitest";
import { knownTrackKm, TRACK_KM } from "./track-km";

describe("knownTrackKm", () => {
  it("matches ignoring case, spaces and punctuation (same rule as the sync)", () => {
    for (const variant of ["Monza", "monza", " MONZA ", "Mon za"]) {
      expect(knownTrackKm(variant)).toBe(5.793);
    }
    expect(knownTrackKm("bahrain wec")).toBe(5.412);
    expect(knownTrackKm("Bahrain (WEC)")).toBe(5.412);
  });

  it("returns null for anything we don't have a trustworthy figure for", () => {
    for (const unknown of ["Bahrain (outer)", "Silverstone (National)", "Fuji (classic)", "", "Nürburgring"]) {
      expect(knownTrackKm(unknown)).toBeNull();
    }
  });

  it("carries no layout variants — guessing those would poison fuel maths", () => {
    // Anything with a parenthesised qualifier other than the two known base
    // layouts (Silverstone GP, Bahrain wec) must be absent.
    const allowed = new Set(["Silverstone (GP)", "Bahrain (wec)"]);
    const variants = Object.keys(TRACK_KM).filter((n) => n.includes("(") && !allowed.has(n));
    expect(variants).toEqual([]);
  });

  it("every distance is plausible for a real circuit", () => {
    for (const [name, km] of Object.entries(TRACK_KM)) {
      expect(km, name).toBeGreaterThan(3);
      expect(km, name).toBeLessThanOrEqual(14);
    }
  });
});
