import { NextResponse } from "next/server";
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

/** POST /api/cars → admin: add a new car { name, category }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; category?: string };
  const name = body.name?.trim();
  const category = body.category as CarCategory;
  if (!name) return NextResponse.json({ error: "Car name is required." }, { status: 400 });
  if (!CAR_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: `Category must be one of ${CAR_CATEGORIES.join(", ")}.` }, { status: 400 });
  }
  const store = getStore();
  await store.init();
  const car = await store.createCar(name, category);
  return NextResponse.json(car, { status: 201 });
}
