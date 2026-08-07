import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStore } from "./db/json-store";
import { findDuplicateDrivers, pickKeeper, type DuplicateMember } from "./duplicate-drivers";
import type { Driver, Session } from "@/types";

const drv = (id: number, name: string, discord_id: string | null = null): Driver =>
  ({ id, name, discord_id, role: "driver", trust_score: 1, created_at: "", updated_at: "" }) as Driver;

const ses = (id: number, driver_id: number, created_at = "2026-08-01T00:00:00.000Z"): Session =>
  ({ id, driver_id, created_at }) as Session;

describe("findDuplicateDrivers", () => {
  it("groups names that differ only by case or punctuation", () => {
    const groups = findDuplicateDrivers([drv(1, "Darren"), drv(2, "darren "), drv(3, "D-arren")], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual([1, 2, 3]);
  });

  it("leaves genuinely different names alone", () => {
    expect(findDuplicateDrivers([drv(1, "Darren"), drv(2, "Dazza"), drv(3, "Alex")], [])).toEqual([]);
  });

  it("counts each member's sessions and newest date", () => {
    const groups = findDuplicateDrivers(
      [drv(1, "Sam"), drv(2, "sam")],
      [ses(1, 1, "2026-07-01T00:00:00.000Z"), ses(2, 1, "2026-08-01T00:00:00.000Z"), ses(3, 2)],
    );
    const one = groups[0].members.find((m) => m.id === 1)!;
    expect(one.sessions).toBe(2);
    expect(one.last_session).toBe("2026-08-01T00:00:00.000Z");
  });

  it("orders groups by how many sessions are at stake", () => {
    const groups = findDuplicateDrivers(
      [drv(1, "Low"), drv(2, "low"), drv(3, "High"), drv(4, "high")],
      [ses(1, 3), ses(2, 3), ses(3, 4), ses(4, 1)],
    );
    expect(groups[0].key).toBe("high");
  });

  it("ignores blank names rather than grouping them together", () => {
    expect(findDuplicateDrivers([drv(1, ""), drv(2, "   ")], [])).toEqual([]);
  });

  it("flags a name collision between DIFFERENT Discord accounts as two real people", () => {
    // Two teammates who share a display name are not a duplicate. The merge API
    // refuses this, so the flag exists to stop the UI offering a doomed button.
    const [g] = findDuplicateDrivers([drv(1, "Sam Twin", "A"), drv(2, "Sam-Twin", "B")], []);
    expect(g.distinct_people).toBe(true);
  });

  it("does NOT flag one linked row beside an unlinked one — that IS the duplicate case", () => {
    const [g] = findDuplicateDrivers([drv(1, "Darren", "A"), drv(2, "darren", null)], []);
    expect(g.distinct_people).toBe(false);
    expect(g.suggested_keep_id).toBe(1);
  });
});

describe("pickKeeper", () => {
  const m = (id: number, sessions: number, discord_id: string | null): DuplicateMember => ({
    id,
    name: `d${id}`,
    discord_id,
    sessions,
    last_session: null,
  });

  it("keeps the Discord-linked row even when it has FEWER sessions", () => {
    // The linked row is the one future logins resolve to. Keeping the other
    // would leave the driver logging into a row we just emptied.
    const k = pickKeeper([m(1, 20, null), m(2, 1, "111")]);
    expect(k.id).toBe(2);
  });

  it("falls back to most sessions when nothing is linked", () => {
    expect(pickKeeper([m(1, 3, null), m(2, 9, null)]).id).toBe(2);
  });

  it("breaks a tie on the lower id", () => {
    expect(pickKeeper([m(7, 4, null), m(2, 4, null)]).id).toBe(2);
  });
});

describe("mergeDrivers", () => {
  let dir: string;
  let store: JsonStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccr-merge-"));
    store = new JsonStore(dir);
    await store.init();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedPair() {
    const keep = await store.getOrCreateDriverByDiscordId("111", "Darren");
    const dupe = await store.getOrCreateDriver("Darren Duplicate");
    const car = await store.createCar("Test Car", "Hypercar");
    const track = await store.createTrack("Test Track");
    const mk = (driver_id: number) =>
      store.createSession({
        driver_id,
        car_id: car.id,
        track_id: track.id,
        session_type: "Practice",
        condition_reported: "Dry",
        lap_count: 5,
        best_lap_time: 100,
        avg_lap_time: 101,
        off_track_count: 0,
        off_track_penalty_points: 0,
        confidence_rating: 7,
        tyre_fl_pct_remaining: 80,
        tyre_fr_pct_remaining: 80,
        tyre_rl_pct_remaining: 80,
        tyre_rr_pct_remaining: 80,
      });
    await mk(keep.id);
    await mk(dupe.id);
    await mk(dupe.id);
    return { keep, dupe };
  }

  it("moves the sessions and removes the emptied driver", async () => {
    const { keep, dupe } = await seedPair();
    const res = await store.mergeDrivers(keep.id, dupe.id);

    expect(res).toEqual({ moved: 2 });
    expect((await store.listDrivers()).map((d) => d.id)).toEqual([keep.id]);
    // ⚠ The real risk: sessions.driver_id is ON DELETE CASCADE, so a merge that
    // deleted first would silently destroy them. All three must survive.
    expect(await store.listSessions()).toHaveLength(3);
    expect((await store.listSessions()).every((s) => s.driver_id === keep.id)).toBe(true);
  });

  it("keeps the tyre data attached to every moved session", async () => {
    // The cascade chain is drivers → sessions → tyres, so a merge that lost
    // sessions would take their tyre rows too. Asserting the second-order data
    // survives, rather than assuming it because the first-order data did.
    const { keep, dupe } = await seedPair();
    await store.mergeDrivers(keep.id, dupe.id);

    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(3);
    for (const s of sessions) {
      expect(s.tyres, `session ${s.id} lost its tyre row`).toBeTruthy();
      expect(s.tyres.tyre_fl_pct_remaining).toBe(80);
    }
  });

  it("refuses to merge a driver into themselves", async () => {
    const { keep } = await seedPair();
    expect(await store.mergeDrivers(keep.id, keep.id)).toBeNull();
    expect(await store.listSessions()).toHaveLength(3);
  });

  it("returns null for an unknown driver and changes nothing", async () => {
    const { keep } = await seedPair();
    expect(await store.mergeDrivers(keep.id, 9999)).toBeNull();
    expect(await store.listDrivers()).toHaveLength(2);
    expect(await store.listSessions()).toHaveLength(3);
  });
});
