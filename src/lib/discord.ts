// ============================================================================
// Discord webhook announcements — one-way pushes into the team channel. A
// webhook is just a channel URL (no bot, no OAuth, no Discord application):
// admin pastes it into the control panel, we POST JSON to it. Announcements
// fire on REAL changes only — #1 flips on a board (batched, one message per
// recompute), a new era, new tracks appearing from a benchmark sync — never on
// routine recomputes that change nothing. All posting is best-effort: a dead
// webhook must NEVER break a recompute or an API route (timeouts swallowed).
// ============================================================================

import { getStore } from "./db";
import type { Store } from "./db/types";

export const WEBHOOK_SETTING = "discord_webhook_url";

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

/** The configured webhook URL, or null. */
export async function getWebhookUrl(store: Store = getStore()): Promise<string | null> {
  const url = await store.getSetting<string>(WEBHOOK_SETTING);
  return typeof url === "string" && url.trim().startsWith("https://") ? url.trim() : null;
}

/**
 * POST a message to the webhook. Best-effort: resolves true/false, never
 * throws. No-op (false) when no webhook is configured.
 */
export async function postDiscord(content: string, store: Store = getStore(), urlOverride?: string): Promise<boolean> {
  const url = urlOverride ?? (await getWebhookUrl(store));
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

const MAX_FLIP_LINES = 8;

/**
 * Announce board #1 takeovers after a recompute — one batched message, only
 * when at least one board's top car actually changed. Never throws.
 */
export async function announceFlips(
  store: Store,
  before: BoardEntry[],
  after: BoardEntry[],
  presetName: string,
): Promise<void> {
  try {
    if (!(await getWebhookUrl(store))) return; // fast exit before any work
    const flips = diffTopCars(before, after);
    if (flips.length === 0) return;

    const [cars, tracks] = await Promise.all([store.listCars(), store.listTracks()]);
    const carName = (id: number) => cars.find((c) => c.id === id)?.name ?? `Car #${id}`;
    const trackName = (id: number) => tracks.find((t) => t.id === id)?.name ?? `Track #${id}`;

    const lines = flips
      .slice(0, MAX_FLIP_LINES)
      .map(
        (f) =>
          `• **${carName(f.car_id)}** takes #1 at ${trackName(f.track_id)} · ${f.class} · ${f.condition} — ${f.car_score.toFixed(1)} (was ${carName(f.prev_car_id)})`,
      );
    if (flips.length > MAX_FLIP_LINES) lines.push(`• …and ${flips.length - MAX_FLIP_LINES} more`);

    await postDiscord(`🏁 **Board update** · ${presetName} weighting\n${lines.join("\n")}`, store);
  } catch {
    /* announcements never break the caller */
  }
}
