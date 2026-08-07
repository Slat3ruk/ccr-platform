// ============================================================================
// Finding drivers that are probably the same person.
//
// These exist for two historical reasons, both now fixed at source (5a8a093):
//   • log-on-behalf resolved by NAME, so a teammate whose stored name had
//     drifted from their Discord nickname gained a second row;
//   • "renaming" someone by editing a session's driver field also resolved by
//     name, creating a driver rather than renaming one.
// This module only REPORTS candidates. Merging is a separate, explicit action —
// it moves real session history between people and must never be automatic.
// ============================================================================

import type { Driver, Session } from "@/types";

/** Same normalisation the benchmark sync uses: letters + digits only. */
function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface DuplicateMember {
  id: number;
  name: string;
  discord_id: string | null;
  sessions: number;
  /** ISO date of their most recent session, or null if they have none. */
  last_session: string | null;
}

export interface DuplicateGroup {
  /** The normalised name the group collided on. */
  key: string;
  members: DuplicateMember[];
  /** Which member to keep, by the rules in `pickKeeper`. A suggestion only. */
  suggested_keep_id: number;
  reason: string;
  /**
   * True when members carry DIFFERENT Discord ids — i.e. these are two real
   * people who share a display name, not one person duplicated. The merge API
   * refuses these, so the UI must not offer a button that is guaranteed to
   * fail; it shows an explanation instead.
   */
  distinct_people: boolean;
}

/**
 * Who should survive a merge:
 *   1. a row with a `discord_id` beats one without — that is the real identity,
 *      and keeping it means future logins resolve to the merged row;
 *   2. failing that, whoever has more sessions (less to move, less to go wrong);
 *   3. failing that, the lower id — the original row.
 * Returned as a SUGGESTION. The admin picks.
 */
export function pickKeeper(members: DuplicateMember[]): { id: number; reason: string } {
  const withId = members.filter((m) => m.discord_id);
  if (withId.length === 1) {
    return { id: withId[0].id, reason: "only row linked to a Discord account" };
  }
  const pool = withId.length > 1 ? withId : members;
  const sorted = [...pool].sort((a, b) => b.sessions - a.sessions || a.id - b.id);
  if (withId.length > 1) {
    return { id: sorted[0].id, reason: "several Discord-linked rows — kept the one with most sessions" };
  }
  return { id: sorted[0].id, reason: "no Discord link on any row — kept the one with most sessions" };
}

/**
 * Groups of drivers whose names collide once case and punctuation are ignored.
 *
 * ⚠ DELIBERATELY CONSERVATIVE. It reports only name collisions, so it will NOT
 * pair "Darren" with "Dazza" — genuinely different names that happen to be the
 * same person need human judgement, and a fuzzy matcher confident enough to
 * catch them would also merge two real teammates with similar names. Those are
 * handled by the manual pair-merge instead. Better to under-report and let a
 * human add, than to over-report and have someone accept a wrong merge.
 */
export function findDuplicateDrivers(drivers: Driver[], sessions: Session[]): DuplicateGroup[] {
  const counts = new Map<number, { n: number; last: string | null }>();
  for (const s of sessions) {
    const cur = counts.get(s.driver_id) ?? { n: 0, last: null };
    cur.n++;
    if (!cur.last || s.created_at > cur.last) cur.last = s.created_at;
    counts.set(s.driver_id, cur);
  }

  const byKey = new Map<string, DuplicateMember[]>();
  for (const d of drivers) {
    const key = normalize(d.name);
    if (!key) continue; // a blank name can't be matched on
    const stat = counts.get(d.id) ?? { n: 0, last: null };
    const member: DuplicateMember = {
      id: d.id,
      name: d.name,
      discord_id: d.discord_id ?? null,
      sessions: stat.n,
      last_session: stat.last,
    };
    byKey.set(key, [...(byKey.get(key) ?? []), member]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    const keep = pickKeeper(members);
    const ids = new Set(members.map((m) => m.discord_id).filter(Boolean));
    groups.push({
      key,
      members: [...members].sort((a, b) => b.sessions - a.sessions || a.id - b.id),
      suggested_keep_id: keep.id,
      reason: keep.reason,
      distinct_people: ids.size > 1,
    });
  }
  // Most sessions at stake first — those are the ones worth looking at hardest.
  return groups.sort(
    (a, b) =>
      b.members.reduce((n, m) => n + m.sessions, 0) - a.members.reduce((n, m) => n + m.sessions, 0),
  );
}
