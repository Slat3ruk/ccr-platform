import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getChannelUrl, postDiscord } from "@/lib/discord";
import type { Recommendation, WeightsConfig } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Top recommendation for a race's track/class/condition (score desc, like the briefing). */
function topFor(recs: Recommendation[], trackId: number, cls: string | null | undefined, condition: string | null | undefined) {
  return recs
    .filter(
      (r) =>
        r.track_id === trackId &&
        (cls == null || r.class === cls) &&
        (condition == null || r.condition === condition),
    )
    .sort((a, b) => b.car_score - a.car_score)[0];
}

/**
 * POST /api/races/:id/announce → push the race briefing (BLUF) to the
 * #race-announcements webhook: when, where, the car pick per class racing that
 * weekend, and the engineer's note. Uses Discord's <t:…:F> timestamp when the
 * race has a start time, so every reader sees it in THEIR local timezone —
 * same principle as the briefing page. (Phase 1: gated client-side to
 * Manager/Admin, like the rest of race management.)
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raceId = Number(id);
  if (!Number.isInteger(raceId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const store = getStore();
  await store.init();

  const race = await store.getRace(raceId);
  if (!race) return NextResponse.json({ error: "Race not found." }, { status: 404 });
  if (!(await getChannelUrl(store, "race"))) {
    return NextResponse.json({ error: "No Discord webhook configured — connect one in the control panel first." }, { status: 400 });
  }

  const [tracks, cars, recs, weights] = await Promise.all([
    store.listTracks(),
    store.listCars(),
    store.listRecommendations(),
    store.getSetting<WeightsConfig>("weights"),
  ]);
  const trackName = tracks.find((t) => t.id === race.track_id)?.name ?? `Track #${race.track_id}`;
  const carName = (cid: number) => cars.find((c) => c.id === cid)?.name ?? `Car #${cid}`;

  // When: Discord timestamp renders in each reader's local TZ; date-only otherwise.
  // Each race is posted on its OWN time (managers pick which to post per box).
  const when = race.start_at
    ? `<t:${Math.floor(Date.parse(race.start_at) / 1000)}:F>`
    : new Date(`${race.event_date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const top = topFor(recs, race.track_id, race.class, race.condition);
  const pick = top
    ? `🏎️ Run the **${carName(top.car_id)}** — ${top.car_score.toFixed(1)} (${top.sessions_used} session${top.sessions_used === 1 ? "" : "s"}, ${Math.round(top.confidence_score * 100)}% confidence)`
    : `🏎️ No ranked car yet — log sessions!`;

  const lines: string[] = [
    `📋 **Race briefing — ${race.name?.trim() || trackName}**`,
    `📅 ${when}${race.start_at ? " (your local time)" : ""}`,
    `📍 ${trackName} · ${race.class ?? "all classes"} · ${race.condition ?? "Dry"}`,
    pick,
  ];

  if (race.note?.trim()) {
    lines.push(`📝 ${race.note.trim()}${race.note_by ? ` — *${race.note_by}*` : ""}`);
  }
  lines.push(`_Ranked with the ${weights?.preset ?? "Balanced"} weighting · full breakdown on the briefing page_`);

  const sent = await postDiscord(lines.join("\n"), store, "race");
  if (!sent) return NextResponse.json({ error: "Discord rejected the message — check the webhook." }, { status: 502 });
  return NextResponse.json({ ok: true, sent: true });
}
