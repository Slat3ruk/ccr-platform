// ============================================================================
// One-time importer for the "Ohne Speed" LMU laptimes sheet.
// Reads a saved-as-HTML copy of the sheet and emits committed JSON the app
// seeds from: src/data/benchmarks.json + src/data/tracks.json.
//
// Re-run after downloading a fresh copy of the sheet:
//   npm run import:benchmarks
// Optionally pass the source .htm path as the first arg.
//
// Sheet layout (decoded 2026-07-01): per-class sections; every data row's
// column A is "<track><CLASS>" (e.g. "Spa LMGT3"), column B is the track,
// column C the patch, columns E..J are the tiers alien/competitive/good/
// midpack/tail-ender/offline (1% steps). GTE rows are skipped (no current
// LMU cars map to GTE).
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC =
  process.argv[2] ||
  resolve(ROOT, "Ohne Speed's - LMU laptimes spreadsheet - Google Drive_files/sheet__Z4V.htm");

const CLASS_MAP = {
  LMGT3: "LMGT3",
  LMH: "LMH",
  LMP3: "LMP3",
  LMP2elms: "LMP2-ELMS",
  LMP2wec: "LMP2-WEC",
  // GTE intentionally omitted
};

const COUNTRY = {
  Bahrain: "Bahrain",
  Barcelona: "Spain",
  "Circuit de la Sarthe": "France",
  COTA: "USA",
  Fuji: "Japan",
  Imola: "Italy",
  Interlagos: "Brazil",
  Monza: "Italy",
  "Paul Ricard": "France",
  Portimao: "Portugal",
  Qatar: "Qatar",
  Silverstone: "UK",
  Sebring: "USA",
  Spa: "Belgium",
};

const TIME = /^\d:\d{2}\.\d{2,3}$|^\d{2}\.\d{2,3}$/;

function toSeconds(s) {
  if (!s) return null;
  const raw = s.trim();
  if (raw.includes(":")) {
    const [m, sec] = raw.split(":");
    const mins = Number(m);
    const secs = Number(sec);
    if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
    return Math.round((mins * 60 + secs) * 1000) / 1000;
  }
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

function stripTags(c) {
  return c
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .trim();
}

function baseAndLayout(track) {
  const m = track.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) return { base: m[1].trim(), layout: m[2].trim() };
  return { base: track.trim(), layout: null };
}

const htm = readFileSync(SRC, "utf8");
const rowMatches = htm.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];

const benchmarks = [];
const trackMap = new Map();

for (const row of rowMatches) {
  const tds = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(stripTags);
  if (tds.length < 10) continue;
  const [helper, track, patch] = tds;
  if (!helper || !track) continue;
  if (!TIME.test(tds[4] || "")) continue; // alien column must be a lap time

  const rawClass = (helper.startsWith(track) ? helper.slice(track.length) : helper.replace(track, "")).trim();
  const cls = CLASS_MAP[rawClass];
  if (!cls) continue; // skips GTE / anything unmapped

  const tiers = {
    alien_time: toSeconds(tds[4]),
    competitive_time: toSeconds(tds[5]),
    good_time: toSeconds(tds[6]),
    midpack_time: toSeconds(tds[7]),
    tail_ender_time: toSeconds(tds[8]),
    offline_time: toSeconds(tds[9]),
  };
  if (Object.values(tiers).some((v) => v == null || v <= 0)) continue;

  const { base, layout } = baseAndLayout(track);
  if (!trackMap.has(track)) {
    trackMap.set(track, { name: track, layout_id: layout, country: COUNTRY[base] ?? null });
  }

  benchmarks.push({
    track: track,
    class: cls,
    condition: "Dry",
    patch_version: patch || null,
    data_readiness_pct: 100,
    ...tiers,
  });
}

const tracks = [...trackMap.values()];
const outDir = resolve(ROOT, "src/data");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "benchmarks.json"), JSON.stringify(benchmarks, null, 2) + "\n");
writeFileSync(resolve(outDir, "tracks.json"), JSON.stringify(tracks, null, 2) + "\n");

const byClass = benchmarks.reduce((m, b) => ((m[b.class] = (m[b.class] || 0) + 1), m), {});
console.log(`✅ Parsed ${benchmarks.length} benchmark rows across ${tracks.length} tracks.`);
console.log("   by class:", byClass);
console.log(`   → src/data/benchmarks.json, src/data/tracks.json`);
