import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { eraRange } from "@/lib/eras";
import { scoreGroups, sessionsInRange } from "@/lib/recompute";
import { DEFAULT_WEIGHTS_CONFIG } from "@/lib/scoring";
import type { RacingClass, RankingRow, Condition, WeightsConfig } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rankings?track_id=&class=&condition=&era_id= → recommendations
 * joined with car + track names, sorted by car_score desc. All filters optional.
 *
 * Without era_id: serves the persisted recommendations (the live board — always
 * the current era, kept fresh by recomputes). With era_id (or era_id=pre for
 * the span before the first era): recomputes that archived era's rankings
 * ad-hoc from its sessions, without persisting anything.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const trackId = url.searchParams.get("track_id");
  const cls = url.searchParams.get("class") as RacingClass | null;
  const condition = url.searchParams.get("condition") as Condition | null;
  const eraParam = url.searchParams.get("era_id");

  const store = getStore();
  await store.init();

  const [cars, tracks] = await Promise.all([store.listCars(), store.listTracks()]);
  const carById = new Map(cars.map((c) => [c.id, c]));
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const toRow = (r: Omit<RankingRow, "car_name" | "car_category" | "track_name">): RankingRow => {
    const car = carById.get(r.car_id);
    const track = trackById.get(r.track_id);
    return {
      ...r,
      car_name: car?.name ?? `Car #${r.car_id}`,
      car_category: car?.category ?? "GT3",
      track_name: track?.name ?? `Track #${r.track_id}`,
    };
  };

  // --- Archived-era view: score that era's sessions on the fly ---------------
  if (eraParam != null && eraParam !== "") {
    const eras = await store.listEras();
    const eraId = eraParam === "pre" ? null : Number(eraParam);
    if (eraId !== null && !Number.isInteger(eraId)) {
      return NextResponse.json({ error: "Bad era_id." }, { status: 400 });
    }
    const range = eraRange(eras, eraId);
    if (!range) return NextResponse.json({ error: "Era not found." }, { status: 404 });

    const [allSessions, benchmarks] = await Promise.all([store.listSessions(), store.listBenchmarks()]);
    const config = (await store.getSetting<WeightsConfig>("weights")) ?? DEFAULT_WEIGHTS_CONFIG;
    const { recommendations } = scoreGroups(
      sessionsInRange(allSessions, range),
      cars,
      benchmarks,
      config,
      Date.now(),
    );

    let rows = recommendations
      .map((r, i) => toRow({ ...r, id: -(i + 1), last_updated: new Date().toISOString() }))
      .sort((a, b) => b.car_score - a.car_score);
    if (trackId) rows = rows.filter((r) => r.track_id === Number(trackId));
    if (cls) rows = rows.filter((r) => r.class === cls);
    if (condition) rows = rows.filter((r) => r.condition === condition);
    return NextResponse.json(rows);
  }

  // --- Live board: persisted recommendations (current era) -------------------
  const recs = await store.listRecommendations({
    track_id: trackId ? Number(trackId) : undefined,
    class: cls ?? undefined,
    condition: condition ?? undefined,
  });

  return NextResponse.json(recs.map(toRow));
}
