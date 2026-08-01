import { describe, expect, it } from "vitest";
import { knownTrackKm, TRACK_KM } from "./track-km";
import tracksData from "@/data/tracks.json";

describe("knownTrackKm", () => {
  it("matches ignoring case, spaces and punctuation (same rule as the sync)", () => {
    for (const variant of ["Monza", "monza", " MONZA ", "Mon za"]) {
      expect(knownTrackKm(variant)).toBe(5.781);
    }
    expect(knownTrackKm("bahrain wec")).toBe(5.387);
    expect(knownTrackKm("Bahrain (WEC)")).toBe(5.387);
  });

  it("returns null for a circuit we have not measured", () => {
    for (const unknown of ["Nürburgring", "Watkins Glen", "", "Road Atlanta"]) {
      expect(knownTrackKm(unknown)).toBeNull();
    }
  });

  it("covers every track in the seed data", () => {
    // The 2026-08-01 sweep measured all of them, so a gap here means either a
    // new circuit arrived without being measured, or an entry was lost. Load it
    // in LMU and export from the planner's Debrief tab — do NOT fill it from a
    // published figure.
    const missing = (tracksData as { name: string }[])
      .map((t) => t.name)
      .filter((n) => knownTrackKm(n) === null);
    expect(missing, `unmeasured seed tracks: ${missing.join(", ")}`).toEqual([]);
  });

  it("includes layout variants, which are separately measured", () => {
    // These were deliberately ABSENT before the sweep, because a variant's
    // length genuinely differs from its base circuit and guessing was worse
    // than a blank. Now measured, so they must be present AND distinct.
    expect(knownTrackKm("Paul Ricard (3A)")).toBe(3.752);
    expect(knownTrackKm("Paul Ricard")).toBe(5.807);
    expect(knownTrackKm("Silverstone (National)")).toBe(2.634);
    expect(knownTrackKm("Bahrain (outer)")).toBe(3.511);
    // A variant must never silently inherit its base circuit's length.
    expect(knownTrackKm("Fuji (classic)")).not.toBe(knownTrackKm("Fuji (chicane)"));
    expect(knownTrackKm("Qatar (short)")).not.toBe(knownTrackKm("Qatar"));
    expect(knownTrackKm("Sebring (school)")).not.toBe(knownTrackKm("Sebring"));
  });

  it("every distance is plausible for a real circuit", () => {
    for (const [name, km] of Object.entries(TRACK_KM)) {
      // Silverstone National (2.634) is the shortest layout LMU ships; Le Mans
      // (13.624) the longest.
      expect(km, name).toBeGreaterThan(2.5);
      expect(km, name).toBeLessThanOrEqual(14);
    }
  });

  it("holds MEASURED values, not the published figures they replaced", () => {
    // Each of these is a real correction the 2026-08-01 sweep made. If one
    // reverts, someone has "fixed" a measurement back to a spec sheet.
    const published: Record<string, number> = {
      "Laguna Seca": 3.602, // LMU's own info panel says this; sim runs 3.590
      Daytona: 5.729, // panel again; sim runs 5.734 — note: SHORT, not long
      Sebring: 6.019, // the biggest gap: sim runs 5.820, 199 m less
      Spa: 7.004,
      Monza: 5.793,
      Interlagos: 4.309,
    };
    for (const [name, pub] of Object.entries(published)) {
      expect(TRACK_KM[name], `${name} must not be its published figure`).not.toBe(pub);
    }
  });

  it("published error flips sign between circuits — so no blanket correction is valid", () => {
    // The reason every circuit is measured individually rather than adjusted by
    // a factor derived from one: Laguna's published figure is LONG, Daytona's
    // is SHORT. A correction fitted to either would be wrong on the other.
    expect(3.602 - TRACK_KM["Laguna Seca"]).toBeGreaterThan(0);
    expect(5.729 - TRACK_KM["Daytona"]).toBeLessThan(0);
  });
});
