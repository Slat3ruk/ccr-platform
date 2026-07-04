import { describe, expect, it } from "vitest";
import type { BadgeDef, BadgeHolder } from "@/types";
import { diffBadgeGold, diffTopCars, newBoardKeys, type BoardEntry } from "./discord";

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

describe("newBoardKeys (first-data detection)", () => {
  it("flags a (car,track,condition) combo appearing for the first time", () => {
    const before = [row(1, 10, 90)];
    const after = [row(1, 10, 90), row(2, 10, 70)]; // car 10 now has data at track 2
    expect([...newBoardKeys(before, after)]).toEqual(["10|2|Dry"]);
  });

  it("does not flag existing combos or condition variants it already had", () => {
    const before = [row(1, 10, 90), row(1, 10, 60, "LMGT3", "Wet")];
    const after = [row(1, 10, 92), row(1, 10, 61, "LMGT3", "Wet")];
    expect(newBoardKeys(before, after).size).toBe(0);
  });

  it("a new condition for a known car/track counts as first data", () => {
    const before = [row(1, 10, 90)];
    const after = [row(1, 10, 90), row(1, 10, 55, "LMGT3", "Wet")];
    expect([...newBoardKeys(before, after)]).toEqual(["10|1|Wet"]);
  });
});

describe("diffBadgeGold (leader-board crown takeovers)", () => {
  const holder = (tier: BadgeHolder["tier"], id: number, name: string): BadgeHolder => ({ tier, driver_id: id, driver_name: name, value: 0 });
  const badge = (id: BadgeDef["id"], goldId: number, goldName: string, roast = false): BadgeDef => ({
    id,
    label: id,
    emoji: "🏆",
    hint: "",
    roast,
    holders: [holder("gold", goldId, goldName), holder("silver", 99, "Someone")],
  });

  it("reports a takeover when a badge's gold holder changes", () => {
    const prev = { fastest: 1 };
    const { takeovers, next } = diffBadgeGold(prev, [badge("fastest", 2, "the possum")]);
    expect(takeovers).toHaveLength(1);
    expect(takeovers[0]).toMatchObject({ badgeId: "fastest", newId: 2, newName: "the possum", prevId: 1 });
    expect(next).toEqual({ fastest: 2 });
  });

  it("stays silent on a first-ever award (no previous holder)", () => {
    const { takeovers, next } = diffBadgeGold({}, [badge("fastest", 2, "the possum")]);
    expect(takeovers).toHaveLength(0); // recorded, not announced
    expect(next).toEqual({ fastest: 2 });
  });

  it("no takeover when the same driver keeps the crown", () => {
    const { takeovers } = diffBadgeGold({ fastest: 2 }, [badge("fastest", 2, "the possum")]);
    expect(takeovers).toHaveLength(0);
  });

  it("omits an unheld badge so re-award is first-ever again (silent)", () => {
    const empty: BadgeDef = { id: "fastest", label: "f", emoji: "🏆", hint: "", roast: false, holders: [] };
    const { takeovers, next } = diffBadgeGold({ fastest: 1 }, [empty]);
    expect(takeovers).toHaveLength(0);
    expect(next).toEqual({}); // dropped — a later award won't false-fire as a takeover
  });
});
