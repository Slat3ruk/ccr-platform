// ============================================================================
// Benchmark sync — pulls pace tiers from the public "Ohne Speed" Google Sheet
// and caches them in the store. Contract (SPEC §4): NEVER break rankings — if
// the sync fails or no API key is configured, leave the existing cached/seeded
// benchmarks untouched and report which path was taken.
//
// NOTE: the exact tab/column layout of the Ohne Speed sheet still needs to be
// calibrated against the live sheet. Until then, configure the mapping via the
// env vars below or rely on the seeded placeholder benchmarks. Parsing is
// defensive: anything unexpected is skipped, never thrown.
// ============================================================================

import type { Condition, RacingClass } from "@/types";
import { getStore } from "./db";
import type { Store } from "./db/types";

export interface SyncResult {
  ok: boolean;
  source: "google-sheets" | "cache";
  upserted: number;
  message: string;
}

const SHEET_RANGE = process.env.GOOGLE_SHEETS_RANGE || "A1:Z2000";

/**
 * Attempt a live sync. Returns a structured result; on any problem it resolves
 * with ok:false and source:"cache" rather than throwing.
 */
export async function syncBenchmarks(store: Store = getStore()): Promise<SyncResult> {
  await store.init();

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY?.trim();
  const sheetId = process.env.GOOGLE_SHEETS_ID?.trim();

  if (!apiKey || !sheetId) {
    return {
      ok: false,
      source: "cache",
      upserted: 0,
      message: "GOOGLE_SHEETS_API_KEY / GOOGLE_SHEETS_ID not set — keeping cached/seeded benchmarks.",
    };
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    sheetId,
  )}/values/${encodeURIComponent(SHEET_RANGE)}?key=${encodeURIComponent(apiKey)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return { ok: false, source: "cache", upserted: 0, message: `Sheets API ${res.status} — kept cache.` };
    }

    const json = (await res.json()) as { values?: string[][] };
    const rows = json.values ?? [];
    const parsed = parseBenchmarkRows(rows);

    if (parsed.length === 0) {
      return {
        ok: false,
        source: "cache",
        upserted: 0,
        message: "Fetched the sheet but parsed 0 benchmark rows — mapping needs calibration; kept cache.",
      };
    }

    const tracks = await store.listTracks();
    const trackByName = new Map(tracks.map((t) => [normalize(t.name), t.id]));

    let upserted = 0;
    for (const row of parsed) {
      const trackId = matchTrack(trackByName, row.trackName);
      if (!trackId) continue;
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

    return {
      ok: upserted > 0,
      source: "google-sheets",
      upserted,
      message: upserted > 0 ? `Synced ${upserted} benchmark rows from Google Sheets.` : "No rows matched known tracks; kept cache.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, source: "cache", upserted: 0, message: `Sync error (${message}) — kept cache.` };
  }
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

/**
 * Best-effort row parser. Expects a header row containing recognizable column
 * names (track, class, condition, alien/competitive/good/midpack/tail/offline).
 * Times may be "M:SS.mmm" or seconds. Returns [] if the header isn't found.
 */
function parseBenchmarkRows(rows: string[][]): ParsedBenchmark[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => normalize(h));
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));

  const idx = {
    track: col("track", "circuit"),
    cls: col("class", "category"),
    condition: col("condition", "weather"),
    alien: col("alien"),
    competitive: col("competitive"),
    good: col("good"),
    midpack: col("midpack", "mid pack"),
    tail: col("tailender", "tail ender", "tail"),
    offline: col("offline"),
    readiness: col("readiness", "data"),
    patch: col("patch", "version"),
  };

  if (idx.track < 0 || idx.alien < 0) return []; // not the layout we expect

  const out: ParsedBenchmark[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const trackName = r[idx.track]?.trim();
    if (!trackName) continue;

    const cls = normalizeClass(r[idx.cls]);
    const condition = normalizeCondition(r[idx.condition]);
    const alien = toSeconds(r[idx.alien]);
    if (!cls || alien == null) continue;

    const competitive = toSeconds(r[idx.competitive]) ?? alien * 1.01;
    const good = toSeconds(r[idx.good]) ?? alien * 1.02;
    const midpack = toSeconds(r[idx.midpack]) ?? alien * 1.035;
    const tail = toSeconds(r[idx.tail]) ?? alien * 1.06;
    const offline = toSeconds(r[idx.offline]) ?? alien * 1.07;

    out.push({
      trackName,
      class: cls,
      condition,
      alien_time: alien,
      competitive_time: competitive,
      good_time: good,
      midpack_time: midpack,
      tail_ender_time: tail,
      offline_time: offline,
      data_readiness_pct: clampPct(Number(r[idx.readiness])),
      patch_version: idx.patch >= 0 ? r[idx.patch]?.trim() || null : null,
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

function normalizeCondition(s: string | undefined): Condition {
  const n = normalize(s || "");
  if (n.includes("wet") || n.includes("rain")) return "Wet";
  if (n.includes("mix") || n.includes("damp")) return "Mixed";
  return "Dry";
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

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function matchTrack(trackByName: Map<string, number>, name: string): number | undefined {
  const target = normalize(name);
  // exact normalized match first
  const exact = trackByName.get(target);
  if (exact) return exact;
  // fuzzy: any seeded track whose normalized name contains, or is contained by, the sheet name
  for (const [tname, id] of trackByName) {
    if (tname.includes(target) || target.includes(tname)) return id;
  }
  return undefined;
}
