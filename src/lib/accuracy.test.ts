import { describe, expect, it } from "vitest";
import type { RaceResult } from "@/types";
import { summarizeAccuracy } from "./accuracy";

function result(overrides: Partial<RaceResult>): RaceResult {
  return {
    id: 1,
    track_id: 1,
    class: "LMGT3",
    raced_on: "2026-07-01",
    recommended_car_id: 10,
    raced_car_id: 10,
    verdict: "nailed",
    position: null,
    note: null,
    created_by: null,
    created_at: "2026-07-01T20:00:00Z",
    ...overrides,
  } as RaceResult;
}

describe("summarizeAccuracy", () => {
  it("counts verdicts and computes the hit rate (nailed + solid)", () => {
    const s = summarizeAccuracy([
      result({ id: 1, verdict: "nailed" }),
      result({ id: 2, verdict: "solid" }),
      result({ id: 3, verdict: "missed" }),
      result({ id: 4, verdict: "nailed" }),
    ]);
    expect(s.n).toBe(4);
    expect(s.nailed).toBe(2);
    expect(s.solid).toBe(1);
    expect(s.missed).toBe(1);
    expect(s.hitPct).toBe(75); // 3 of 4
  });

  it("tracks how often the team actually ran the pick", () => {
    const s = summarizeAccuracy([
      result({ id: 1, recommended_car_id: 10, raced_car_id: 10 }), // followed
      result({ id: 2, recommended_car_id: 10, raced_car_id: 22 }), // overruled
      result({ id: 3, recommended_car_id: null, raced_car_id: 22 }), // no pick existed
    ]);
    expect(s.withPick).toBe(2);
    expect(s.followed).toBe(1);
  });

  it("is honest about an empty scoreboard", () => {
    const s = summarizeAccuracy([]);
    expect(s.n).toBe(0);
    expect(s.hitPct).toBeNull();
  });
});
