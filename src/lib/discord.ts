// ============================================================================
// Discord webhook announcements — one-way pushes into the team's channels. A
// webhook is just a channel URL (no bot, no OAuth, no Discord application):
// admin pastes URLs into the control panel, we POST JSON to them.
//
// THREE CHANNELS, routed by how the team consumes each feed (2026-07-04):
//   race  → #race-announcements — big, rare: new eras, #1 takeovers on tracks
//           with an UPCOMING RACE (car choice may change). Lockable read-only.
//   test  → #testdrivers — the working feed: session logged, first data for a
//           combo, all other #1 takeovers, new tracks from a benchmark sync.
//   board → #leader-board — driver-board banter: badge/crown takeovers
//           (announcer lands in a follow-up; the slot is live and testable).
// Fallback: an event whose channel isn't configured posts to the first
// configured slot (race → test → board), so a single-webhook setup gets
// everything, and nothing silently vanishes.
//
// Announcements fire on REAL changes only and are best-effort: a dead webhook
// must NEVER break a recompute or an API route (timeouts swallowed).
// ============================================================================

import type { BadgeDef, Benchmark, Car, Driver, Session } from "@/types";
import { getStore } from "./db";
import type { Store } from "./db/types";
import { computeBadges, computeDriverStats } from "./driverAnalytics";

export type WebhookChannel = "race" | "test" | "board";

/** Setting key per channel. "race" keeps the original key — the first-ever
 *  connected webhook (round 14) stays wired without migration. */
export const WEBHOOK_SETTINGS: Record<WebhookChannel, string> = {
  race: "discord_webhook_url",
  test: "discord_webhook_test_url",
  board: "discord_webhook_board_url",
};

/** Minimal shape a board row needs for flip detection. */
export interface BoardEntry {
  track_id: number;
  class: string;
  condition: string;
  car_id: number;
  car_score: number;
}

export interface TopFlip {
  track_id: number;
  class: string;
  condition: string;
  car_id: number;
  car_score: number;
  prev_car_id: number;
}

/** The #1 car per board (track|class|condition). Ties: higher score, then lower car_id. */
function topsOf(rows: BoardEntry[]): Map<string, BoardEntry> {
  const tops = new Map<string, BoardEntry>();
  for (const r of rows) {
    const key = `${r.track_id}|${r.class}|${r.condition}`;
    const cur = tops.get(key);
    if (!cur || r.car_score > cur.car_score || (r.car_score === cur.car_score && r.car_id < cur.car_id)) {
      tops.set(key, r);
    }
  }
  return tops;
}

/**
 * Boards whose #1 car CHANGED between two recommendation sets. Boards that are
 * new (no previous top — first data, seeds) or gone (purge/era cut) are not
 * flips; only a genuine takeover is news.
 */
export function diffTopCars(before: BoardEntry[], after: BoardEntry[]): TopFlip[] {
  const prev = topsOf(before);
  const next = topsOf(after);
  const flips: TopFlip[] = [];
  for (const [key, top] of next) {
    const was = prev.get(key);
    if (was && was.car_id !== top.car_id) {
      flips.push({
        track_id: top.track_id,
        class: top.class,
        condition: top.condition,
        car_id: top.car_id,
        car_score: top.car_score,
        prev_car_id: was.car_id,
      });
    }
  }
  return flips;
}

/**
 * (car|track|condition) group keys present in `after` but not `before` — a
 * combo's FIRST data. Used to flag "first data for this combo" on the session
 * ping (detected here, announced by the sessions route).
 */
export function newBoardKeys(before: BoardEntry[], after: BoardEntry[]): Set<string> {
  const had = new Set(before.map((r) => `${r.car_id}|${r.track_id}|${r.condition}`));
  const fresh = new Set<string>();
  for (const r of after) {
    const key = `${r.car_id}|${r.track_id}|${r.condition}`;
    if (!had.has(key)) fresh.add(key);
  }
  return fresh;
}

/** The configured URL for a channel, following the fallback order. Null = nothing configured. */
export async function getChannelUrl(store: Store, channel: WebhookChannel): Promise<string | null> {
  const order: WebhookChannel[] = [channel, "race", "test", "board"];
  for (const ch of order) {
    const url = await store.getSetting<string>(WEBHOOK_SETTINGS[ch]);
    if (typeof url === "string" && url.trim().startsWith("https://")) return url.trim();
  }
  return null;
}

/** True when at least one webhook is configured (cheap guard before diff work). */
export async function anyWebhook(store: Store): Promise<boolean> {
  return (await getChannelUrl(store, "race")) != null;
}

/**
 * POST a message to a channel's webhook (with fallback). Best-effort: resolves
 * true/false, never throws. No-op (false) when nothing is configured.
 */
export async function postDiscord(
  content: string,
  store: Store = getStore(),
  channel: WebhookChannel = "race",
  urlOverride?: string,
): Promise<boolean> {
  const url = urlOverride ?? (await getChannelUrl(store, channel));
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Discord caps content at 2000 chars.
      body: JSON.stringify({ content: content.slice(0, 1990) }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// --- Driver-board badge takeovers (#leader-board) ----------------------------

export const BADGE_HOLDERS_SETTING = "badge_gold_holders";

export interface BadgeTakeover {
  badgeId: string;
  label: string;
  emoji: string;
  roast: boolean;
  newId: number;
  newName: string;
  prevId: number;
}

/**
 * Pure diff of GOLD badge holders vs the last-announced snapshot. A takeover is
 * only reported when a badge HAD a holder and it changed — a first-ever award
 * (no previous holder) is recorded silently, so early data doesn't spam. Returns
 * the takeovers plus the fresh snapshot to persist. (Only gold is tracked — the
 * crown changing hands is the news; silver/bronze shuffles aren't.)
 */
export function diffBadgeGold(prev: Record<string, number>, badges: BadgeDef[]): { takeovers: BadgeTakeover[]; next: Record<string, number> } {
  const next: Record<string, number> = {};
  const takeovers: BadgeTakeover[] = [];
  for (const b of badges) {
    const gold = b.holders.find((h) => h.tier === "gold");
    if (!gold) continue; // badge unheld (too little data) — omit so a future award is "first-ever" again
    next[b.id] = gold.driver_id;
    const prevId = prev[b.id];
    if (prevId != null && prevId !== gold.driver_id) {
      takeovers.push({ badgeId: b.id, label: b.label, emoji: b.emoji, roast: b.roast, newId: gold.driver_id, newName: gold.driver_name, prevId });
    }
  }
  return { takeovers, next };
}

/**
 * Announce driver-board crown takeovers to #leader-board after a recompute.
 * Always refreshes the stored snapshot (so it tracks truth even with no webhook);
 * only POSTs when a webhook is reachable AND a crown actually changed hands.
 * Never throws.
 */
export async function announceBadges(
  store: Store,
  sessions: Session[],
  drivers: Driver[],
  cars: Car[],
  benchmarks: Benchmark[],
  nowMs: number,
): Promise<void> {
  try {
    const stats = computeDriverStats(sessions, drivers, cars, benchmarks, nowMs);
    const badges = computeBadges(stats);
    const prev = (await store.getSetting<Record<string, number>>(BADGE_HOLDERS_SETTING)) ?? {};
    const { takeovers, next } = diffBadgeGold(prev, badges);
    await store.setSetting(BADGE_HOLDERS_SETTING, next); // always persist the truth

    if (takeovers.length === 0) return;
    if (!(await getChannelUrl(store, "board"))) return; // snapshot updated; nothing to post

    const nameOf = (id: number) => drivers.find((d) => d.id === id)?.name ?? `Driver #${id}`;
    const lines = takeovers.map((t) =>
      t.roast
        ? `${t.emoji} **${t.newName}** grabs the **${t.label}** crown off **${nameOf(t.prevId)}** 😬`
        : `${t.emoji} **${t.newName}** takes **${t.label}** from **${nameOf(t.prevId)}**`,
    );
    await postDiscord(`🏆 **Leader-board shakeup**\n${lines.join("\n")}`, store, "board");
  } catch {
    /* announcements never break the recompute */
  }
}

const MAX_FLIP_LINES = 8;

/**
 * Announce board #1 takeovers after a recompute — batched, only when a top
 * actually changed. Takeovers on tracks with an UPCOMING race are race-channel
 * news (car choice may change); the rest are test-channel feedback. Never throws.
 */
export async function announceFlips(
  store: Store,
  before: BoardEntry[],
  after: BoardEntry[],
  presetName: string,
): Promise<void> {
  try {
    if (!(await anyWebhook(store))) return; // fast exit before any work
    const flips = diffTopCars(before, after);
    if (flips.length === 0) return;

    const [cars, tracks, races] = await Promise.all([store.listCars(), store.listTracks(), store.listRaces()]);
    const carName = (id: number) => cars.find((c) => c.id === id)?.name ?? `Car #${id}`;
    const trackName = (id: number) => tracks.find((t) => t.id === id)?.name ?? `Track #${id}`;

    const today = new Date().toISOString().slice(0, 10);
    const raceTracks = new Set(races.filter((r) => r.event_date >= today).map((r) => r.track_id));

    const line = (f: TopFlip) =>
      `• **${carName(f.car_id)}** takes #1 at ${trackName(f.track_id)} · ${f.class} · ${f.condition} — ${f.car_score.toFixed(1)} (was ${carName(f.prev_car_id)})`;
    const batch = (list: TopFlip[]) => {
      const lines = list.slice(0, MAX_FLIP_LINES).map(line);
      if (list.length > MAX_FLIP_LINES) lines.push(`• …and ${list.length - MAX_FLIP_LINES} more`);
      return lines.join("\n");
    };

    const raceFlips = flips.filter((f) => raceTracks.has(f.track_id));
    const testFlips = flips.filter((f) => !raceTracks.has(f.track_id));

    if (raceFlips.length > 0) {
      await postDiscord(`🚨 **Race-week board change** · ${presetName} weighting\n${batch(raceFlips)}`, store, "race");
    }
    if (testFlips.length > 0) {
      await postDiscord(`🏁 **Board update** · ${presetName} weighting\n${batch(testFlips)}`, store, "test");
    }
  } catch {
    /* announcements never break the caller */
  }
}
