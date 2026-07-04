import { NextResponse } from "next/server";
import { getStore } from "@/lib/db";
import { getWebhookUrl, postDiscord, WEBHOOK_SETTING } from "@/lib/discord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/webhook → whether a webhook is configured (URL not echoed in full). */
export async function GET() {
  const store = getStore();
  await store.init();
  const url = await getWebhookUrl(store);
  return NextResponse.json({
    configured: url != null,
    // Enough to recognise it, not enough to leak the token.
    hint: url ? `${url.slice(0, 45)}…` : null,
  });
}

/**
 * POST /api/admin/webhook → manage the Discord webhook.
 * Body: { action: "save", url } (empty url clears) | { action: "test" }.
 * (Phase 1: gated client-side to Admin, like the rest of the control panel.)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; url?: unknown };
  const store = getStore();
  await store.init();

  if (body.action === "save") {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (url && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
      return NextResponse.json(
        { error: "That doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/…)." },
        { status: 400 },
      );
    }
    await store.setSetting(WEBHOOK_SETTING, url); // "" = cleared
    return NextResponse.json({ ok: true, configured: url !== "" });
  }

  if (body.action === "test") {
    const url = await getWebhookUrl(store);
    if (!url) return NextResponse.json({ error: "No webhook configured — save a URL first." }, { status: 400 });
    const sent = await postDiscord(
      "✅ **CCR platform connected** — announcements will land here: board #1 takeovers, new eras, new tracks from the benchmark sheet.",
      store,
    );
    if (!sent) return NextResponse.json({ error: "Discord rejected the message — check the URL." }, { status: 502 });
    return NextResponse.json({ ok: true, sent: true });
  }

  return NextResponse.json({ error: "action must be \"save\" or \"test\"." }, { status: 400 });
}
