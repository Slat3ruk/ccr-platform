// ============================================================================
// Client-safe display helpers (no server imports).
// ============================================================================

/** Map a 0-100 score to a colour on the purple→green→…→red gradient. */
export function scoreColor(score: number): string {
  if (score >= 90) return "#b277f0"; // purple — elite
  if (score >= 80) return "#23a55a"; // green
  if (score >= 70) return "#14b8a6"; // teal
  if (score >= 55) return "#f0b232"; // yellow
  if (score >= 40) return "#f57c00"; // orange
  return "#f23f43"; // red
}

/** Slightly muted variant for factor bars. */
export function factorColor(score: number): string {
  return scoreColor(score);
}

export function confidenceColor(conf: number): string {
  if (conf >= 0.75) return "#23a55a";
  if (conf >= 0.4) return "#f0b232";
  return "#f23f43";
}

export function fmtScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

export function fmtPct(conf: number | null | undefined): string {
  if (conf == null || !Number.isFinite(conf)) return "—";
  return `${Math.round(conf * 100)}%`;
}

export function categoryLabel(category: string): string {
  return category;
}
