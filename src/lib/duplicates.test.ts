import { describe, expect, it } from "vitest";
import { DUPLICATE_WINDOW_MS, findDuplicate, minutesAgo, type DuplicateCandidate } from "./duplicates";
import type { Session } from "@/types";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

function existing(over: Partial<Session> = {}): Session {
  return {
    id: 1,
    driver_id: 1,
    car_id: 2,
    track_id: 3,
    condition_reported: "Dry",
    lap_count: 12,
    best_lap_time: 102.318,
    avg_lap_time: 103.502,
    created_at: new Date(NOW - 60_000).toISOString(), // 1 min ago
    ...over,
  } as unknown as Session;
}

const candidate: DuplicateCandidate = {
  driver_id: 1,
  car_id: 2,
  track_id: 3,
  condition_reported: "Dry",
  lap_count: 12,
  best_lap_time: 102.318,
  avg_lap_time: 103.502,
};

describe("findDuplicate", () => {
  it("catches the real case — the same run submitted twice", () => {
    expect(findDuplicate([existing()], candidate, NOW)?.id).toBe(1);
  });

  it("ignores an empty history", () => {
    expect(findDuplicate([], candidate, NOW)).toBeNull();
  });

  it("does not flag a different driver, car, track or condition", () => {
    expect(findDuplicate([existing({ driver_id: 9 })], candidate, NOW)).toBeNull();
    expect(findDuplicate([existing({ car_id: 9 })], candidate, NOW)).toBeNull();
    expect(findDuplicate([existing({ track_id: 9 })], candidate, NOW)).toBeNull();
    expect(findDuplicate([existing({ condition_reported: "Wet" })], candidate, NOW)).toBeNull();
  });

  it("does not flag a genuinely different run on the same combo", () => {
    // A second stint differs somewhere — that's the whole point of the strict test.
    expect(findDuplicate([existing({ lap_count: 13 })], candidate, NOW)).toBeNull();
    expect(findDuplicate([existing({ best_lap_time: 102.5 })], candidate, NOW)).toBeNull();
    expect(findDuplicate([existing({ avg_lap_time: 103.9 })], candidate, NOW)).toBeNull();
  });

  it("compares lap times on the millisecond grid, not exact floats", () => {
    expect(findDuplicate([existing({ best_lap_time: 102.3180001 })], candidate, NOW)?.id).toBe(1);
  });

  it("expires: an identical run outside the window isn't a double-submit", () => {
    const old = existing({ created_at: new Date(NOW - DUPLICATE_WINDOW_MS - 1000).toISOString() });
    expect(findDuplicate([old], candidate, NOW)).toBeNull();
    const justInside = existing({ created_at: new Date(NOW - DUPLICATE_WINDOW_MS + 1000).toISOString() });
    expect(findDuplicate([justInside], candidate, NOW)?.id).toBe(1);
  });

  it("ignores rows with an unusable timestamp rather than throwing", () => {
    expect(findDuplicate([existing({ created_at: "not-a-date" })], candidate, NOW)).toBeNull();
  });
});

describe("minutesAgo", () => {
  it("rounds to whole minutes and never goes negative", () => {
    expect(minutesAgo(existing(), NOW)).toBe(1);
    expect(minutesAgo(existing({ created_at: new Date(NOW + 5000).toISOString() }), NOW)).toBe(0);
  });
});
