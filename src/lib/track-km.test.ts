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

  it("Daytona carries LMU's own in-game figure, NOT the planner's unsourced one", () => {
    // 5.729 km from LMU's track info panel (user screenshot, 2026-07-29) —
    // 13 turns there confirms the road course rather than the 4.023 km oval.
    // Provisional: supersede with scoring `track_length` once someone drives it.
    expect(knownTrackKm("Daytona")).toBe(5.729);
    // The planner's TRACKS has 5.734 with no traceable provenance. Pinned so a
    // future session can't quietly swap LMU's own number for that one.
    expect(knownTrackKm("Daytona")).not.toBe(5.734);
  });

  it("prefers the MEASURED length over LMU's own info panel", () => {
    // Proven 2026-07-29: LMU's track info panel reads 3.602 km for Laguna while
    // scoring shared memory measures 3590 m — same circuit, same build. The
    // panel is published spec, so it is NOT the source of truth here. If anyone
    // "corrects" this to 3.602 they reintroduce a 12 m/lap error into fuel maths.
    expect(TRACK_KM["Laguna Seca"]).toBe(3.59);
    expect(TRACK_KM["Laguna Seca"]).not.toBe(3.602);
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
