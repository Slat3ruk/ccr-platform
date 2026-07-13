import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { isSilenced, postDiscord, WEBHOOK_SETTINGS, WEBHOOK_SILENCE_SETTING, type WebhookChannel } from "@/lib/discord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isChannel(v: unknown): v is WebhookChannel {
  return v === "race" || v === "test" || v === "board";
}

/** Status of one slot: configured + a recognisable (not leakable) hint. */
async function slotStatus(store: Awaited<ReturnType<typeof getStore>>, channel: WebhookChannel) {
  const url = await store.getSetting<string>(WEBHOOK_SETTINGS[channel]);
  const ok = typeof url === "string" && url.trim().startsWith("https://");
  return { configured: ok, hint: ok ? `${url!.trim().slice(0, 45)}…` : null };
}

/** GET /api/admin/webhook → per-channel status (URLs never echoed in full) + global silence state. */
export async function GET() {
  const store = getStore();
  await store.init();
  const [race, test, board, silenced] = await Promise.all([
    slotStatus(store, "race"),
    slotStatus(store, "test"),
    slotStatus(store, "board"),
    isSilenced(store),
  ]);
  return NextResponse.json({ race, test, board, silenced });
}

const TEST_MESSAGES: Record<WebhookChannel, string> = {
  race: "✅ This is the **race-announcements** feed — new eras and #1 takeovers on tracks with an upcoming race land here.",
  test: "✅ This is the **test-drivers** feed — session pings, first-data flags, board updates and new tracks land here.",
  board: "✅ This is the **leader-board** feed — driver-board badge & crown takeovers will land here.",
};

/**
 * POST /api/admin/webhook → manage webhooks.
 * Body: { action: "save", channel, url } (empty url clears) | { action: "test", channel }
 *     | { action: "silence" } | { action: "resume" } (global, no channel needed).
 * Admin only, like the rest of the control panel.
 */
export async function POST(req: Request) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["admin"]);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { action?: unknown; channel?: unknown; url?: unknown };
  const store = getStore();
  await store.init();

  if (body.action === "silence" || body.action === "resume") {
    const silenced = body.action === "silence";
    await store.setSetting(WEBHOOK_SILENCE_SETTING, silenced);
    return NextResponse.json({ ok: true, silenced });
  }

  if (!isChannel(body.channel)) {
    return NextResponse.json({ error: 'channel must be "race", "test" or "board".' }, { status: 400 });
  }

  if (body.action === "save") {
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (url && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
      return NextResponse.json(
        { error: "That doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/…)." },
        { status: 400 },
      );
    }
    await store.setSetting(WEBHOOK_SETTINGS[body.channel], url); // "" = cleared
    return NextResponse.json({ ok: true, channel: body.channel, configured: url !== "" });
  }

  if (body.action === "test") {
    if (await isSilenced(store)) {
      return NextResponse.json({ error: "Webhooks are silenced — resume them first to send a test message." }, { status: 409 });
    }
    // Test the SLOT's own URL (no fallback) — the point is verifying which
    // channel this specific URL lands in.
    const url = await store.getSetting<string>(WEBHOOK_SETTINGS[body.channel]);
    if (typeof url !== "string" || !url.trim().startsWith("https://")) {
      return NextResponse.json({ error: "No webhook saved for this slot — save a URL first." }, { status: 400 });
    }
    const sent = await postDiscord(TEST_MESSAGES[body.channel], store, body.channel, url.trim());
    if (!sent) return NextResponse.json({ error: "Discord rejected the message — check the URL." }, { status: 502 });
    return NextResponse.json({ ok: true, sent: true });
  }

  return NextResponse.json({ error: 'action must be "save", "test", "silence" or "resume".' }, { status: 400 });
}
