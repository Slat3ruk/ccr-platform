import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonStore } from "./db/json-store";

/**
 * Driver identity must key on `discord_id`, never on the typed name. A name
 * lookup is how the same person ends up with two rows and a split leaderboard.
 */
describe("driver identity", () => {
  let dir: string;
  let store: JsonStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccr-driver-identity-"));
    store = new JsonStore(dir);
    await store.init();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("follows a Discord nickname change instead of freezing the old name", async () => {
    const first = await store.getOrCreateDriverByDiscordId("111", "Darren");
    const renamed = await store.getOrCreateDriverByDiscordId("111", "Dazza");

    expect(renamed.id).toBe(first.id); // same person
    expect(renamed.name).toBe("Dazza"); // name followed
    expect(await store.listDrivers()).toHaveLength(1); // and did NOT split
  });

  it("propagates a capitalisation-only fix", async () => {
    await store.getOrCreateDriverByDiscordId("111", "darren");
    const fixed = await store.getOrCreateDriverByDiscordId("111", "Darren");
    expect(fixed.name).toBe("Darren");
    expect(await store.listDrivers()).toHaveLength(1);
  });

  it("a rename can never split a driver, however many times they do it", async () => {
    const a = await store.getOrCreateDriverByDiscordId("111", "Name One");
    await store.getOrCreateDriverByDiscordId("111", "Name Two");
    const c = await store.getOrCreateDriverByDiscordId("111", "Name Three");
    expect(c.id).toBe(a.id);
    expect(await store.listDrivers()).toHaveLength(1);
  });

  it("keeps different people apart even when their names collide", async () => {
    const one = await store.getOrCreateDriverByDiscordId("111", "Alex");
    const two = await store.getOrCreateDriverByDiscordId("222", "Alex");
    expect(two.id).not.toBe(one.id);
    expect(await store.listDrivers()).toHaveLength(2);
  });

  it("claims a pre-auth name-typed driver rather than duplicating them", async () => {
    // Sessions logged before Discord auth created bare name rows with no id.
    const legacy = await store.getOrCreateDriver("Darren");
    expect(legacy.discord_id).toBeNull();

    const claimed = await store.getOrCreateDriverByDiscordId("111", "Darren");
    expect(claimed.id).toBe(legacy.id); // adopted, keeping their history
    expect(claimed.discord_id).toBe("111");
    expect(await store.listDrivers()).toHaveLength(1);
  });

  it("THE DUPLICATE BUG: a drifted name resolves by id, not by name", async () => {
    // Someone logs in as "Darren", then renames themselves in Discord.
    await store.getOrCreateDriverByDiscordId("111", "Darren");
    await store.getOrCreateDriverByDiscordId("111", "Dazza");

    // A manager now logs on their behalf. The roster offers the CURRENT Discord
    // name, and resolving by discord_id must find the same row.
    const viaId = await store.getOrCreateDriverByDiscordId("111", "Dazza");
    expect(await store.listDrivers()).toHaveLength(1);
    expect(viaId.name).toBe("Dazza");

    // Whereas a NAME lookup for a name nobody currently holds makes a new row —
    // this is the behaviour the API now avoids by sending driver_discord_id.
    await store.getOrCreateDriver("Darren");
    expect(await store.listDrivers()).toHaveLength(2);
  });
});
