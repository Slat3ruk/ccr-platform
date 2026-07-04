import { describe, expect, it } from "vitest";
import { diffTopCars, type BoardEntry } from "./discord";

function row(track: number, car: number, score: number, cls = "LMGT3", condition = "Dry"): BoardEntry {
  return { track_id: track, class: cls, condition, car_id: car, car_score: score };
}

describe("diffTopCars (webhook flip detection)", () => {
  it("reports a genuine #1 takeover on a board", () => {
    const before = [row(1, 10, 90), row(1, 11, 85)];
    const after = [row(1, 10, 88), row(1, 11, 91)];
    const flips = diffTopCars(before, after);
    expect(flips).toHaveLength(1);
    expect(flips[0]).toMatchObject({ track_id: 1, car_id: 11, prev_car_id: 10, car_score: 91 });
  });

  it("stays silent when the order doesn't change", () => {
    const before = [row(1, 10, 90), row(1, 11, 85)];
    const after = [row(1, 10, 92), row(1, 11, 89)]; // scores moved, top didn't
    expect(diffTopCars(before, after)).toHaveLength(0);
  });

  it("ignores brand-new boards (first data / seeds) and vanished boards (purge)", () => {
    const before = [row(1, 10, 90)];
    const after = [row(2, 20, 80)]; // board 1 gone, board 2 new
    expect(diffTopCars(before, after)).toHaveLength(0);
  });

  it("treats boards as separate per class and condition", () => {
    const before = [row(1, 10, 90), row(1, 30, 90, "LMH"), row(1, 40, 90, "LMGT3", "Wet")];
    const after = [row(1, 11, 95), row(1, 30, 90, "LMH"), row(1, 40, 90, "LMGT3", "Wet")];
    const flips = diffTopCars(before, after);
    expect(flips).toHaveLength(1); // only the Dry LMGT3 board flipped
    expect(flips[0].car_id).toBe(11);
  });
});
