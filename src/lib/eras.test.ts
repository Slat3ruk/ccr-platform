import { describe, expect, it } from "vitest";
import type { Era } from "@/types";
import { currentEra, currentEraRange, eraRange, inRange, sortEras } from "./eras";

function era(id: number, starts_at: string, name = `Era ${id}`): Era {
  return { id, name, starts_at, reason: null, created_by: null, created_at: starts_at };
}

const T = (s: string) => Date.parse(s);

const ERAS: Era[] = [
  era(1, "2026-03-01T00:00:00.000Z", "Launch"),
  era(2, "2026-06-01T00:00:00.000Z", "Patch 1.3"),
];

describe("sortEras", () => {
  it("orders by starts_at regardless of input order", () => {
    const shuffled = [ERAS[1], ERAS[0]];
    expect(sortEras(shuffled).map((e) => e.id)).toEqual([1, 2]);
  });
});

describe("currentEra", () => {
  it("returns null when no eras exist (implicit all-data era)", () => {
    expect(currentEra([], T("2026-07-01T00:00:00Z"))).toBeNull();
  });

  it("picks the latest era that has started", () => {
    expect(currentEra(ERAS, T("2026-07-01T00:00:00Z"))?.id).toBe(2);
    expect(currentEra(ERAS, T("2026-04-01T00:00:00Z"))?.id).toBe(1);
  });

  it("ignores future-dated eras until they start", () => {
    const withFuture = [...ERAS, era(3, "2027-01-01T00:00:00.000Z")];
    expect(currentEra(withFuture, T("2026-07-01T00:00:00Z"))?.id).toBe(2);
    expect(currentEra(withFuture, T("2027-02-01T00:00:00Z"))?.id).toBe(3);
  });

  it("returns null before the first era begins", () => {
    expect(currentEra(ERAS, T("2026-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("eraRange", () => {
  it("bounds an archived era by the next era's start", () => {
    const r = eraRange(ERAS, 1)!;
    expect(r.fromMs).toBe(T("2026-03-01T00:00:00Z"));
    expect(r.toMs).toBe(T("2026-06-01T00:00:00Z"));
  });

  it("leaves the newest era open-ended", () => {
    const r = eraRange(ERAS, 2)!;
    expect(r.fromMs).toBe(T("2026-06-01T00:00:00Z"));
    expect(r.toMs).toBe(Infinity);
  });

  it("null id = the implicit pre-era span", () => {
    const r = eraRange(ERAS, null)!;
    expect(r.fromMs).toBe(-Infinity);
    expect(r.toMs).toBe(T("2026-03-01T00:00:00Z"));
  });

  it("null id with no eras = all time", () => {
    const r = eraRange([], null)!;
    expect(r.fromMs).toBe(-Infinity);
    expect(r.toMs).toBe(Infinity);
  });

  it("unknown id → null", () => {
    expect(eraRange(ERAS, 99)).toBeNull();
  });
});

describe("currentEraRange + inRange", () => {
  it("scores everything when no eras exist", () => {
    const r = currentEraRange([], T("2026-07-01T00:00:00Z"));
    expect(inRange(T("2020-01-01T00:00:00Z"), r)).toBe(true);
    expect(inRange(T("2026-07-01T00:00:00Z"), r)).toBe(true);
  });

  it("drawing a line excludes older sessions from the live range", () => {
    const r = currentEraRange(ERAS, T("2026-07-01T00:00:00Z"));
    expect(inRange(T("2026-05-15T00:00:00Z"), r)).toBe(false); // pre-boundary
    expect(inRange(T("2026-06-15T00:00:00Z"), r)).toBe(true); // in current era
  });

  it("boundary session belongs to the new era (inclusive start)", () => {
    const r = currentEraRange(ERAS, T("2026-07-01T00:00:00Z"));
    expect(inRange(T("2026-06-01T00:00:00Z"), r)).toBe(true);
  });

  it("a future-dated era does not hide today's sessions", () => {
    const withFuture = [...ERAS, era(3, "2027-01-01T00:00:00.000Z")];
    const r = currentEraRange(withFuture, T("2026-07-01T00:00:00Z"));
    expect(inRange(T("2026-06-15T00:00:00Z"), r)).toBe(true);
  });
});
