import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonStore } from "./db/json-store";
import { syncBenchmarks } from "./benchmark-sync";

// A trimmed but VERBATIM excerpt of the real "Ohne Speed" published CSV (tab
// gid 1766901750, captured 2026-07-13) — the exact rows that previously fooled
// the parser into reading one column early. Column 3 ("Hotlap/Q") is a
// separate best-lap metric, not a pace tier; the 8 real race-pace columns run
// 4–11 (~100/101/102/103/104/105/106/107%). Guards this exact regression.
const SHEET_CSV = [
  ",You can contact me on my discord/YT channel:,,,,https://discord.com/invite/dFAqhnuSXH,,,,,https://www.youtube.com/@ohne_speed,,,,,,,,,,,,,,,",
  ",Last updated: 2026.07.10. 09:55. CEST,,,,,,,,,,,,,,,,,,,,,,,,",
  ",,Thanks for the source for laptimes:,beAlien YT,Go YT,Hymo YT,,,,,,,ACC spreadsheet,,,,,,,,,,,,,",
  ',,,,"IF consistent, the following percentages more or less means:",,,,,,,,AC EVO spreadsheet,,,,,,,,,,,,,',
  ",,,,L M G T 3,,,,,,,,,,,,,,,,,,,,,",
  ",,,Hotlap/Q,R a c e   p a c e,,,,,,,,,,,,,,1%,1%,1%,48%,48%,48%,48%,48%",
  ",,,,Alien,Competitive,Good,,Midpack,,Tail-ender,Offline,,,,,,,,,,Data readiness,,,,",
  ",Track,Patch,Class avgW,~100%,101%,102%,103%,104%,105%,106%,107%,Fastest car,Laptime,Best/Avg,,,,0.5+,1.0+,1.1+,1.2+,1.23+,1.24+,1.3+,1.4+",
  "Bahrain (wec)LMGT3,Bahrain (wec),1.3 +,1:58.50,1:59.09,2:00.28,2:01.47,2:02.66,2:03.85,2:05.04,2:06.23,2:07.43,Lamborghini Huracan EVO II (v1.33),1:58.22,-0.35%,1:58.63,LMGT3,9,100%,100%,100%,100%,100%,100%,100%,0%",
  "Bahrain (endurance)LMGT3,Bahrain (endurance),1.3 +,2:25.57,2:26.30,2:27.76,2:29.23,2:30.69,2:32.15,2:33.62,2:35.08,2:36.54,Porsche 992 (v1.33),2:25.21,-0.37%,2:25.76,LMGT3,9,100%,100%,100%,100%,60%,60%,60%,0%",
].join("\n");

describe("syncBenchmarks column mapping (regression: was off by one column)", () => {
  let dir: string;
  let store: JsonStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ccr-benchmark-sync-test-"));
    store = new JsonStore(dir);
    await store.init();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(SHEET_CSV, { status: 200 })),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the 8 race-pace columns (4–11), not the old off-by-one columns", async () => {
    const result = await syncBenchmarks(store);
    expect(result.ok).toBe(true);
    expect(result.upserted).toBe(2);

    const rows = await store.listBenchmarks();
    const bahrainWec = rows.find((r) => r.class === "LMGT3" && r.condition === "Dry" && r.alien_time < 120);
    expect(bahrainWec).toBeTruthy();
    // col4 ~100% = 1:59.09, NOT col3's "Hotlap/Q" value 1:58.50.
    expect(bahrainWec!.alien_time).toBeCloseTo(119.09, 2);
    expect(bahrainWec!.competitive_time).toBeCloseTo(120.28, 2); // col5 101%
    expect(bahrainWec!.good_time).toBeCloseTo(122.66, 2); // col7 103% (Good's slower edge)
    expect(bahrainWec!.midpack_time).toBeCloseTo(125.04, 2); // col9 105% (Midpack's slower edge)
    expect(bahrainWec!.tail_ender_time).toBeCloseTo(126.23, 2); // col10 106%
    expect(bahrainWec!.offline_time).toBeCloseTo(127.43, 2); // col11 107%
  });

  it("extracts the sheet's own 'Last updated' note", async () => {
    const result = await syncBenchmarks(store);
    expect(result.sheet_last_updated).toBe("2026.07.10. 09:55. CEST");
  });
});
