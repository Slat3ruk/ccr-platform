import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { recomputeAll } from "@/lib/recompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drivers/merge → fold one driver into another.
 * Body: `{ keep_id, remove_id, confirm: "MERGE" }`. **Admin only.**
 *
 * Moves every session from `remove_id` to `keep_id`, deletes the emptied row,
 * then recomputes so the leaderboard reflects the combined history.
 *
 * ⚠ NOT REVERSIBLE. The sessions are re-pointed and the losing row is gone;
 * nothing records which sessions came from where. Hence: admin-only, an explicit
 * `confirm` string so it cannot fire from a stray click, and a UI that shows
 * both rows and their session counts before offering the button. Take a backup
 * before a bulk tidy-up — `pg_dump` is the only undo.
 */
export async function POST(req: Request) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["admin"]);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.confirm !== "MERGE") {
    return NextResponse.json({ error: 'Confirmation required: send { "confirm": "MERGE" }.' }, { status: 400 });
  }

  const keepId = Number(body.keep_id);
  const removeId = Number(body.remove_id);
  if (!Number.isInteger(keepId) || !Number.isInteger(removeId)) {
    return NextResponse.json({ error: "keep_id and remove_id must be driver ids." }, { status: 400 });
  }
  if (keepId === removeId) {
    return NextResponse.json({ error: "Can't merge a driver into themselves." }, { status: 400 });
  }

  const store = getStore();
  await store.init();

  // Read both BEFORE the merge so the response can name them — afterwards the
  // removed row no longer exists to look up.
  const drivers = await store.listDrivers();
  const keep = drivers.find((d) => d.id === keepId);
  const remove = drivers.find((d) => d.id === removeId);
  if (!keep) return NextResponse.json({ error: `No driver with id ${keepId}.` }, { status: 404 });
  if (!remove) return NextResponse.json({ error: `No driver with id ${removeId}.` }, { status: 404 });

  // Refuse to merge two rows that BOTH carry a Discord id — that means two
  // different Discord accounts, i.e. two different people, and the collision is
  // a shared display name rather than a duplicate. Merging would destroy one
  // person's history. An admin who genuinely wants this must unlink one first.
  if (keep.discord_id && remove.discord_id && keep.discord_id !== remove.discord_id) {
    return NextResponse.json(
      {
        error:
          `“${keep.name}” and “${remove.name}” are linked to DIFFERENT Discord accounts, so they are two ` +
          `different people who happen to share a name. Refusing to merge — this would delete one of their histories.`,
      },
      { status: 409 },
    );
  }

  const result = await store.mergeDrivers(keepId, removeId);
  if (!result) return NextResponse.json({ error: "Merge failed — driver not found." }, { status: 404 });

  const recompute = await recomputeAll(store);
  return NextResponse.json({
    ok: true,
    kept: { id: keep.id, name: keep.name },
    removed: { id: remove.id, name: remove.name },
    sessions_moved: result.moved,
    recompute,
  });
}
