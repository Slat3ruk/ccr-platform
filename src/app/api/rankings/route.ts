import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import type { RacingClass, RankingRow, Condition } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rankings?track_id=&class=&condition= → recommendations joined with
 * car + track names, sorted by car_score desc. All filters optional.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const trackId = url.searchParams.get("track_id");
  const cls = url.searchParams.get("class") as RacingClass | null;
  const condition = url.searchParams.get("condition") as Condition | null;

  const store = getStore();
  await store.init();

  const [recs, cars, tracks] = await Promise.all([
    store.listRecommendations({
      track_id: trackId ? Number(trackId) : undefined,
      class: cls ?? undefined,
      condition: condition ?? undefined,
    }),
    store.listCars(),
    store.listTracks(),
  ]);

  const carById = new Map(cars.map((c) => [c.id, c]));
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const rows: RankingRow[] = recs.map((r) => {
    const car = carById.get(r.car_id);
    const track = trackById.get(r.track_id);
    return {
      ...r,
      car_name: car?.name ?? `Car #${r.car_id}`,
      car_category: car?.category ?? "GT3",
      track_name: track?.name ?? `Track #${r.track_id}`,
    };
  });

  return NextResponse.json(rows);
}
