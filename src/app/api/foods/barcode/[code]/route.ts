import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { findOwnFoodByBarcode, getFood, upsertFood } from "@/db/foods";
import { foods } from "@/db/schema";
import { apiSession } from "@/lib/api";
import { fetchOffProduct } from "@/lib/off";

/**
 * GET /api/foods/barcode/4607004012044 — продукт по штрихкоду: сначала свой
 * («КБЖУ с упаковки», POST /api/foods), затем из общего справочника, иначе из
 * Open Food Facts с сохранением в справочник (source=off). Чужие свои продукты
 * не находятся. Этим же путём сохраняется выбранный результат поиска в OFF.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/foods/barcode/[code]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { code } = await ctx.params;
  if (!/^\d{8,14}$/.test(code)) return Response.json({ error: "bad barcode" }, { status: 400 });

  const own = await findOwnFoodByBarcode(db, session.user.id, code);
  if (own) return Response.json(own);

  const cachedFood = async () => (cached ? Response.json(await getFood(db, session.user.id, cached.id)) : null);
  const [cached] = await db
    .select({ id: foods.id })
    .from(foods)
    .where(and(eq(foods.source, "off"), eq(foods.sourceRef, code)));
  try {
    const product = await fetchOffProduct(code);
    if (!product) {
      return (await cachedFood()) ?? Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(await upsertFood(db, product));
  } catch (e) {
    console.error("[off] product", e);
    return (await cachedFood()) ?? Response.json({ error: "Open Food Facts не отвечает" }, { status: 502 });
  }
}
