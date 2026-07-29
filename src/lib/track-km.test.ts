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

  it("carries Laguna Seca at its MEASURED length, not the published one", () => {
    // 3590 m read from scoring shared memory in-game (2026-07-29, LMU 1.4).
    // The published 3.602 km is 12 m longer and would bias fuel-per-lap.
    expect(knownTrackKm("Laguna Seca")).toBe(3.59);
    expect(knownTrackKm("Laguna Seca")).not.toBe(3.602);
  });

  it("Daytona stays ABSENT until someone measures it in-game", () => {
    // Deliberate: the planner's TRACKS has 5.734 with no known provenance, and
    // published is ~5.729. That 5 m spread is the same order as the real
    // measured-vs-published gap, so neither can be trusted. A null shows as
    // "no distance" in the control panel, which is the honest state.
    expect(knownTrackKm("Daytona")).toBeNull();
    expect(TRACK_KM).not.toHaveProperty("Daytona");
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
