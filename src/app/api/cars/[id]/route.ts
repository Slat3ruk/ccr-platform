import { NextResponse } from "next/server";
import { forbidUnless } from "@/lib/auth/authz";
import { getVerifiedSession } from "@/lib/auth/session";
import { getStore } from "@/lib/db";
import { CAR_CATEGORIES, type CarCategory } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/cars/:id → rename a car or fix its category. Manager/Admin. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const { id } = await ctx.params;
  const carId = Number(id);
  if (!Number.isInteger(carId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { name?: string; category?: CarCategory } = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Car name can't be blank." }, { status: 400 });
    patch.name = name;
  }
  if (typeof body.category === "string") {
    if (!CAR_CATEGORIES.includes(body.category as CarCategory)) {
      return NextResponse.json({ error: `Category must be one of ${CAR_CATEGORIES.join(", ")}.` }, { status: 400 });
    }
    patch.category = body.category as CarCategory;
  }

  const store = getStore();
  await store.init();

  if (patch.name) {
    const clash = (await store.listCars()).find(
      (c) => c.id !== carId && c.name.toLowerCase() === patch.name!.toLowerCase(),
    );
    if (clash) return NextResponse.json({ error: `A car named "${clash.name}" already exists.` }, { status: 409 });
  }

  const car = await store.updateCar(carId, patch);
  if (!car) return NextResponse.json({ error: "Car not found." }, { status: 404 });
  return NextResponse.json({ ok: true, car });
}

/**
 * DELETE /api/cars/:id → remove a car. Manager/Admin.
 *
 * ⚠ THE REFERENCE CHECK IS LOAD-BEARING. sessions, recommendations,
 * test_requests and race_results all reference cars(id) ON DELETE CASCADE, so
 * deleting a car in use would silently take that data with it. Refused unless
 * nothing references it — safe for exactly the intended job: removing a car
 * added by mistake, or a duplicate, before anyone logged against it.
 * A car that IS in use should be renamed instead (PATCH above).
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getVerifiedSession();
  const denied = forbidUnless(session.role, ["manager", "admin"]);
  if (denied) return denied;

  const { id } = await ctx.params;
  const carId = Number(id);
  if (!Number.isInteger(carId)) return NextResponse.json({ error: "Bad id." }, { status: 400 });

  const store = getStore();
  await store.init();

  const car = await store.getCar(carId);
  if (!car) return NextResponse.json({ error: "Car not found." }, { status: 404 });

  const [sessions, requests, results] = await Promise.all([
    store.listSessions({ car_id: carId }),
    store.listTestRequests(),
    store.listRaceResults(),
  ]);

  const blocking: string[] = [];
  const n = (count: number, one: string) => (count === 1 ? `1 ${one}` : `${count} ${one}s`);
  if (sessions.length) blocking.push(n(sessions.length, "logged session"));
  const tr = requests.filter((r) => r.car_id === carId).length;
  if (tr) blocking.push(n(tr, "test request"));
  // raced_car_id CASCADEs; recommended_car_id only nulls, so it isn't blocking.
  const rr = results.filter((r) => r.raced_car_id === carId).length;
  if (rr) blocking.push(n(rr, "race result"));

  if (blocking.length) {
    return NextResponse.json(
      {
        error:
          `Can't delete “${car.name}” — it still has ${blocking.join(", ")}. ` +
          `Deleting it would take that data with it. Rename it instead if you're merging a duplicate.`,
        blocking,
      },
      { status: 409 },
    );
  }

  await store.deleteCar(carId);
  return NextResponse.json({ ok: true, deleted: car.name });
}
