// ============================================================================
// Race-calendar helpers: decide which manually-added race is the "featured"
// briefing right now.
//
// The team's pattern: the main race is a Saturday, with Friday/Sunday as
// optional bonus days. So a race becomes the featured BLUF briefing from
// LEAD_DAYS before its date (the requested 3-day cut-off → opens Wednesday for
// a Saturday race) through TRAIL_DAYS after (stays live through Sunday). Tune
// the two constants to shift the window.
// ============================================================================

import type { RaceEvent } from "@/types";

export const LEAD_DAYS = 3; // featured window opens this many days before event_date
export const TRAIL_DAYS = 1; // …and stays featured this many days after

export type RaceStatus = "featured" | "upcoming" | "past";

export interface RaceWindow<T extends RaceEvent = RaceEvent> {
  race: T;
  status: RaceStatus;
  /** Whole days from today to the event (0 = today, negative = in the past). */
  daysUntil: number;
}

/** Midnight (local) of a YYYY-MM-DD event date, in ms. */
function eventMidnightMs(race: RaceEvent): number {
  const d = new Date(`${race.event_date.slice(0, 10)}T00:00:00`);
  return d.getTime();
}

/** Midnight (local) of today, in ms. */
function todayMidnightMs(nowMs: number): number {
  const n = new Date(nowMs);
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

function statusFor(daysUntil: number): RaceStatus {
  if (daysUntil > LEAD_DAYS) return "upcoming";
  if (daysUntil < -TRAIL_DAYS) return "past";
  return "featured";
}

/** Classify every race relative to `nowMs`, soonest-event first. */
export function classifyRaces<T extends RaceEvent>(races: T[], nowMs: number): RaceWindow<T>[] {
  const today = todayMidnightMs(nowMs);
  return races
    .map((race) => {
      const daysUntil = Math.round((eventMidnightMs(race) - today) / 86_400_000);
      return { race, daysUntil, status: statusFor(daysUntil) };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil || a.race.id - b.race.id);
}

export interface FeaturedResult<T extends RaceEvent> {
  /** The race to headline now, or null if none is in-window. */
  featured: RaceWindow<T> | null;
  /** The next future race when nothing is featured (so the page still shows something). */
  next: RaceWindow<T> | null;
  upcoming: RaceWindow<T>[];
  past: RaceWindow<T>[];
}

/**
 * Pick the race to feature: the in-window race whose event day is nearest
 * (ties → the sooner one). When nothing is in-window, expose the next upcoming
 * race so the page can show a "coming up" card instead of a headline.
 */
export function pickFeatured<T extends RaceEvent>(races: T[], nowMs: number): FeaturedResult<T> {
  const classified = classifyRaces(races, nowMs);
  const featuredCandidates = classified
    .filter((w) => w.status === "featured")
    .sort((a, b) => Math.abs(a.daysUntil) - Math.abs(b.daysUntil) || a.daysUntil - b.daysUntil);
  const upcoming = classified.filter((w) => w.status === "upcoming");
  const past = classified.filter((w) => w.status === "past").reverse(); // most-recent first

  return {
    featured: featuredCandidates[0] ?? null,
    next: upcoming[0] ?? null,
    upcoming,
    past,
  };
}

/** Human phrasing for a countdown, e.g. "in 3 days", "today", "2 days ago". */
export function countdownLabel(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil === -1) return "yesterday";
  if (daysUntil > 1) return `in ${daysUntil} days`;
  return `${Math.abs(daysUntil)} days ago`;
}
