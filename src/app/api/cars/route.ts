import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { CAR_CATEGORIES, type CarCategory } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/cars → all cars. */
export async function GET() {
  const store = getStore();
  await store.init();
  return NextResponse.json(await store.listCars());
}

/**
 * POST /api/cars → add a car { name, category }. Manager/Admin only.
 * Reference data every ranking board is keyed to, so a junk entry pollutes
 * every dropdown — not a driver-level action.
 */
export async function POST(req: Request) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { name?: string; category?: string };
  const name = body.name?.trim();
  const category = body.category as CarCategory;
  if (!name) return NextResponse.json({ error: "Car name is required." }, { status: 400 });
  if (!CAR_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Category must be one of ${CAR_CATEGORIES.join(", ")}.` }, { status: 400 });
  }

  const store = getStore();
  await store.init();

  // Surface the clash rather than silently upserting over an existing car.
  const clash = (await store.listCars()).find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (clash) return NextResponse.json({ error: `A car named "${clash.name}" already exists.` }, { status: 409 });

  const car = await store.createCar(name, category);
  return NextResponse.json(car, { status: 201 });
}
