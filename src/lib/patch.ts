// ============================================================================
// Patch versions — the LMU build the app is currently on. LMU uses FOUR tiers
// (confirmed vs SteamDB, e.g. "V1.3.3.4 - Update 3, Patch 3, Hotfix 4"):
//   version . update . patch . hotfix  →  "1.3.3.4"
// Two jobs:
//   1. Deciding, when the current patch changes, whether it RESETS data
//      comparability (a version/update/patch bump draws an era line) or is
//      just a hotfix relabel (keeps the data).
//   2. Flagging a session whose SETUP was built on an older patch than the one
//      it was logged under (→ depreciated Representativeness + a ⚠, phase 2).
// Free-text tolerant: anything unparseable returns null and the callers no-op.
// Shorter strings pad with zeros ("1.3" → [1,3,0,0]) so legacy 3-part entries
// still parse and compare sanely.
// ============================================================================

/** Settings key holding the current LMU patch string (e.g. "1.3.3.4"). */
export const CURRENT_PATCH_SETTING = "current_patch";

export type PatchTuple = [number, number, number, number];

/** Parse "1.3.3.4" (or "v1.3", "1.3.3.4 (wet)") → [1,3,3,4]; missing parts = 0. Null if no leading number. */
export function parsePatch(s: string | null | undefined): PatchTuple | null {
  if (!s) return null;
  const m = s.trim().match(/^v?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0), Number(m[4] ?? 0)];
}

/** -1 if a<b, 0 if equal, 1 if a>b; null if either is unparseable. */
export function comparePatch(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parsePatch(a);
  const pb = parsePatch(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export type PatchChangeKind = "same" | "hotfix" | "patch" | "update" | "version" | "unknown";

/**
 * Which tier changed moving prev → next. Drives the smart default for
 * "draw a comparability line": a `version`, `update`, or `patch` change usually
 * resets data (draw the line), a `hotfix` usually doesn't (just relabel).
 */
export function patchChangeKind(prev: string | null | undefined, next: string | null | undefined): PatchChangeKind {
  const a = parsePatch(prev);
  const b = parsePatch(next);
  if (!b) return "unknown";
  if (!a) return "version"; // first patch ever set — treat as a fresh line
  if (a[0] !== b[0]) return "version";
  if (a[1] !== b[1]) return "update";
  if (a[2] !== b[2]) return "patch";
  if (a[3] !== b[3]) return "hotfix";
  return "same";
}

/** True when a version/update/patch (not hotfix) bump — i.e. the default should draw a line. */
export function shouldDrawLineByDefault(prev: string | null | undefined, next: string | null | undefined): boolean {
  const kind = patchChangeKind(prev, next);
  return kind === "version" || kind === "update" || kind === "patch";
}

/** True when `setup` is a strictly older patch than `current` (both parseable). */
export function isOlderSetupPatch(setup: string | null | undefined, current: string | null | undefined): boolean {
  return comparePatch(setup, current) === -1;
}

/**
 * True when `setup` is old enough (vs `current`) that its data should be
 * DEPRECIATED — i.e. strictly older AND the gap is at the patch tier or higher.
 * A hotfix-only gap (e.g. setup "1.3.3" vs current "1.3.3.4") is the SAME era
 * and does NOT depreciate, matching shouldDrawLineByDefault(): a hotfix doesn't
 * draw a comparability line, so it shouldn't discount weight either. This is
 * what the scoring/quality layers gate on — NOT isOlderSetupPatch (which counts
 * any tier, hotfix included, and so over-penalised current-patch data).
 */
export function isSetupPatchStale(setup: string | null | undefined, current: string | null | undefined): boolean {
  return comparePatch(setup, current) === -1 && patchChangeKind(setup, current) !== "hotfix";
}

/**
 * Normalise an Ohne Speed sheet patch label to dotted form. The sheet writes
 * "1.24+" meaning LMU 1.2.4 (digits concatenated) and "1.3 +" meaning 1.3 —
 * observed labels: "1.1 +", "1.2 +", "1.23+", "1.24+", "1.3 +". A two-segment
 * label whose second segment has 2+ digits gets its digits split ("1.24" →
 * "1.2.4"); already-dotted labels ("1.3.3.4") pass through. Null if no number.
 * (Ambiguity note: this reads a future "1.10" as 1.1.0 — that's the sheet's
 * own shorthand ambiguity; revisit if LMU ever ships an update ≥ 10.)
 */
export function normalizeSheetPatchLabel(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^v?\s*(\d+(?:\.\d+)*)/i);
  if (!m) return null;
  const segs = m[1].split(".");
  if (segs.length === 2 && segs[1].length > 1) return [segs[0], ...segs[1].split("")].join(".");
  return m[1];
}

/**
 * The newest parseable patch among `strings` (e.g. benchmark rows' patch labels —
 * wet rows carry suffixes like "1.3.3.4 (wet +8%)", which parse fine). Returns
 * the bare numeric prefix ("1.3.3.4"), ready to prefill the set-patch form.
 * Null when nothing parses. Drives the control-panel sheet-patch nudge.
 */
export function newestPatchIn(strings: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const s of strings) {
    const m = s?.trim().match(/^v?\s*(\d+(?:\.\d+){0,3})/i);
    if (!m) continue;
    const candidate = m[1];
    if (best === null || comparePatch(candidate, best) === 1) best = candidate;
  }
  return best;
}
