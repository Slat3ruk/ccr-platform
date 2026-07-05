import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { postDiscord } from "@/lib/discord";
import { CURRENT_PATCH_SETTING } from "@/lib/patch";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/patch → the current LMU patch string the app is on (null if unset). */
export async function GET() {
  const store = getStore();
  await store.init();
  const current = (await store.getSetting<string>(CURRENT_PATCH_SETTING)) ?? null;
  return NextResponse.json({ current_patch: current });
}

/**
 * POST /api/patch → set the current patch. Body: { version, draw_line?, reason? }.
 * Always updates the label (auto-stamped onto new sessions + shown in the header).
 * When `draw_line` is true it ALSO draws an era line so older data drops off the
 * live board — the caller decides (a version/patch bump usually should, a hotfix
 * usually shouldn't). (Phase 1: gated client-side to Admin.)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!version) return NextResponse.json({ error: "A version is required (e.g. 1.3.4)." }, { status: 400 });

  const store = getStore();
  await store.init();
  await store.setSetting(CURRENT_PATCH_SETTING, version);

  let era = null;
  let recompute = null;
  if (body.draw_line === true) {
    era = await store.createEra({
      name: version,
      starts_at: new Date().toISOString(),
      reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null,
      created_by: "Admin",
    });
    recompute = await recomputeAll(store);
    await postDiscord(
      `📢 **New patch: ${version}**${era.reason ? ` — ${era.reason}` : ""}\nThe live board now scores sessions from this line onward; older data stays viewable from the patch selector.`,
      store,
      "race",
    );
  }

  return NextResponse.json({ ok: true, current_patch: version, drew_line: era != null, era, recompute });
}
