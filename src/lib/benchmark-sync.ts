// ============================================================================
// Benchmark sync — pulls pace tiers from the public "Ohne Speed" LMU laptimes
// spreadsheet and caches them in the store.
//
// The sheet is PUBLISHED TO WEB (anyone-with-link), so we read the keyless CSV
// export of the master laptimes tab — no Google API key, no secret to manage.
// Just press the button. URL/ID is stable (published-doc id), matching how the
// team already uses the sheet: when new cars/tracks/layouts drop, Ohne Speed
// updates the sheet and a sync pulls the fresh numbers.
//
// Contract (SPEC §4): NEVER break rankings — if the fetch or parse fails, leave
// the existing cached/seeded benchmarks untouched and report which path ran.
// Missing tracks (new layouts) are AUTO-CREATED so a brand-new circuit flows
// straight through instead of being silently skipped.
//
// Live CSV layout (decoded 2026-07-03, tab gid 1766901750): a single grid,
// per-class sections. Each data row: col0 = "<track><CLASS>" (e.g. "SpaLMGT3"),
// col1 = track, col2 = patch, and the pace tiers at cols 3/4/5/7/9/10 =
// Alien / Competitive / Good / Midpack / Tail-ender / Offline (the sheet's own
// labels; 103% and 105% columns are unlabelled and skipped). All rows are Dry.
// ============================================================================

import type { Condition, RacingClass } from "@/types";
import { getStore } from "./db";
import type { Store } from "./db/types";

// Wet pace penalty. LMU dry→fully-wet loss runs ~5–10% (per Ohne Speed / user
// research; e.g. a 3:30 Le Mans lap → 15–25s ≈ 7–12%). We DERIVE Wet benchmark
// tiers as dry × (1 + pct/100) rather than sourcing them — the sheet is dry-only.
// The factor is admin-tunable (control panel, stored setting "wet_penalty").
export const DEFAULT_WET_PENALTY_PCT = 8;
export const WET_PENALTY_SETTING = "wet_penalty";

export interface SyncResult {
  ok: boolean;
  source: "google-sheets" | "cache";
  upserted: number;
  tracks_created: number;
  /** Names of tracks auto-created this sync (new circuits/layouts on the sheet). */
  created_tracks: string[];
  message: string;
}

// Published-doc id + tab gid of the master laptimes grid. Overridable via env
// in case Ohne Speed ever republishes, but hardcoded so the button works with
// zero configuration (the sheet is public).
const PUBLISHED_ID =
  process.env.OHNE_SPEED_PUBLISHED_ID?.trim() ||
  "2PACX-1vTN03UvJDm99byA6vQPZHKOCYVvfxLu1zkJAzdaKyROykzEKY2-Xl1rl1q5znZEf36m88dxMKsY2eaO";
const GID = process.env.OHNE_SPEED_GID?.trim() || "1766901750";

const CSV_URL = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pub?output=csv&gid=${GID}`;

// Tier → column index in a data row (the sheet's own labels, see header note).
const COL = { helper: 0, track: 1, patch: 2, alien: 3, competitive: 4, good: 5, midpack: 7, tail: 9, offline: 10 } as const;

/**
 * Attempt a live sync from the public CSV. Returns a structured result; on any
 * problem it resolves with ok:false / source:"cache" rather than throwing.
 */
export async function syncBenchmarks(store: Store = getStore()): Promise<SyncResult> {
  await store.init();

  let text: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(CSV_URL, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timeout);
    if (!res.ok) {
      return { ok: false, source: "cache", upserted: 0, tracks_created: 0, created_tracks: [], message: `Sheet fetch ${res.status} — kept cache.` };
    }
    text = await res.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, source: "cache", upserted: 0, tracks_created: 0, created_tracks: [], message: `Sync error (${message}) — kept cache.` };
  }

  const parsed = parseBenchmarkRows(parseCsv(text));
  if (parsed.length === 0) {
    return {
      ok: false,
      source: "cache",
      upserted: 0,
      tracks_created: 0,
      created_tracks: [],
      message: "Fetched the sheet but parsed 0 benchmark rows — layout may have changed; kept cache.",
    };
  }

  const tracks = await store.listTracks();
  const trackByName = new Map(tracks.map((t) => [normalize(t.name), t.id]));

  let upserted = 0;
  const createdTracks: string[] = [];
  for (const row of parsed) {
    let trackId = matchTrack(trackByName, row.trackName);
    if (!trackId) {
      // Auto-create a new track/layout the sheet has that we don't yet.
      const created = await store.createTrack(row.trackName);
      trackId = created.id;
      trackByName.set(normalize(created.name), created.id);
      createdTracks.push(created.name);
    }
    await store.upsertBenchmark({
      track_id: trackId,
      class: row.class,
      condition: row.condition,
      alien_time: row.alien_time,
      competitive_time: row.competitive_time,
      good_time: row.good_time,
      midpack_time: row.midpack_time,
      tail_ender_time: row.tail_ender_time,
      offline_time: row.offline_time,
      data_readiness_pct: row.data_readiness_pct,
      patch_version: row.patch_version,
    });
    upserted++;
  }

  const bits = [`Synced ${upserted} benchmark rows from the Ohne Speed sheet`];
  if (createdTracks.length > 0) bits.push(`created ${createdTracks.length} new track${createdTracks.length === 1 ? "" : "s"}`);
  return {
    ok: true,
    source: "google-sheets",
    upserted,
    tracks_created: createdTracks.length,
    created_tracks: createdTracks,
    message: `${bits.join(" · ")}.`,
  };
}

/**
 * Regenerate Wet benchmark tiers from the current Dry sheets, scaling every tier
 * by (1 + pct/100). Upsert-keyed on (track, class, Wet), so re-running just
 * overwrites — no stale rows. Returns how many wet rows were written. A uniform
 * global penalty for now; per-track hand-tuning can layer on later.
 */
export async function deriveWetBenchmarks(store: Store = getStore(), pct: number = DEFAULT_WET_PENALTY_PCT): Promise<number> {
  await store.init();
  const factor = 1 + pct / 100;
  const dry = (await store.listBenchmarks()).filter((b) => b.condition === "Dry");
  let n = 0;
  for (const d of dry) {
    await store.upsertBenchmark({
      track_id: d.track_id,
      class: d.class,
      condition: "Wet",
      alien_time: d.alien_time * factor,
      competitive_time: d.competitive_time * factor,
      good_time: d.good_time * factor,
      midpack_time: d.midpack_time * factor,
      tail_ender_time: d.tail_ender_time * factor,
      offline_time: d.offline_time * factor,
      data_readiness_pct: d.data_readiness_pct,
      patch_version: d.patch_version ? `${d.patch_version} (wet +${pct}%)` : `wet +${pct}%`,
    });
    n++;
  }
  return n;
}

// --- parsing helpers ---------------------------------------------------------

interface ParsedBenchmark {
  trackName: string;
  class: RacingClass;
  condition: Condition;
  alien_time: number;
  competitive_time: number;
  good_time: number;
  midpack_time: number;
  tail_ender_time: number;
  offline_time: number;
  data_readiness_pct: number;
  patch_version: string | null;
}

/** Minimal RFC-4180 CSV parser (handles quoted fields, escaped quotes, newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseBenchmarkRows(rows: string[][]): ParsedBenchmark[] {
  const out: ParsedBenchmark[] = [];
  for (const r of rows) {
    if (!r || r.length <= COL.offline) continue;
    const helper = (r[COL.helper] ?? "").trim();
    const trackName = (r[COL.track] ?? "").trim();
    if (!helper || !trackName) continue;

    const alien = toSeconds(r[COL.alien]);
    if (alien == null) continue; // header / spacer / non-data row

    // Class is the col0 suffix after the track string (e.g. "SpaLMGT3" → "LMGT3").
    const rawClass = helper.startsWith(trackName) ? helper.slice(trackName.length).trim() : helper.replace(trackName, "").trim();
    const cls = normalizeClass(rawClass);
    if (!cls) continue; // skips GTE / unmapped

    const competitive = toSeconds(r[COL.competitive]) ?? alien * 1.01;
    const good = toSeconds(r[COL.good]) ?? alien * 1.02;
    const midpack = toSeconds(r[COL.midpack]) ?? alien * 1.04;
    const tail = toSeconds(r[COL.tail]) ?? alien * 1.06;
    const offline = toSeconds(r[COL.offline]) ?? alien * 1.07;

    out.push({
      trackName,
      class: cls,
      condition: "Dry",
      alien_time: alien,
      competitive_time: competitive,
      good_time: good,
      midpack_time: midpack,
      tail_ender_time: tail,
      offline_time: offline,
      data_readiness_pct: 100,
      patch_version: (r[COL.patch] ?? "").trim() || null,
    });
  }
  return out;
}

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeClass(s: string | undefined): RacingClass | null {
  const n = normalize(s || "");
  if (!n) return null;
  if (n.includes("gt3") || n.includes("lmgt3")) return "LMGT3";
  if (n.includes("lmh") || n.includes("hyper") || n.includes("lmdh")) return "LMH";
  if (n.includes("lmp3") || n === "p3") return "LMP3";
  if (n.includes("wec")) return "LMP2-WEC";
  if (n.includes("lmp2") || n.includes("elms") || n === "p2") return "LMP2-ELMS";
  return null;
}

function toSeconds(s: string | undefined): number | null {
  if (!s) return null;
  const raw = s.trim();
  if (!raw) return null;
  if (raw.includes(":")) {
    const [m, sec] = raw.split(":");
    const mins = Number(m);
    const secs = Number(sec);
    if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
    return mins * 60 + secs;
  }
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function matchTrack(trackByName: Map<string, number>, name: string): number | undefined {
  // EXACT normalized match only. Fuzzy/contains matching would collapse layout
  // variants ("Bahrain (wec)" → "Bahrain") onto one track and overwrite each
  // other's benchmarks. A genuine miss auto-creates the track instead.
  return trackByName.get(normalize(name));
}
