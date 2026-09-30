import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { findOwnFoodByBarcode, getFood, upsertFood } from "@/db/foods";
import { foods } from "@/db/schema";
import { apiSession } from "@/lib/api";
import { fetchOffProduct } from "@/lib/off";

/**
 * GET /api/foods/barcode/4607004012044 — продукт по штрихкоду (сканер): сначала
 * свой («КБЖУ с упаковки», POST /api/foods), иначе свежий из Open Food Facts с
 * сохранением в справочник (source=off); OFF не ответил или товара там нет —
 * сохранённый раньше, если он есть. Чужие свои продукты не находятся.
 *
 * ?source=off — именно товар OFF, без своего продукта: так сохраняется и
 * выбирается результат поиска в OFF (FoodSearch, PickFoodSheet, RecipeEditor).
 * Пользователь выбрал конкретный товар из списка — свой продукт с тем же
 * штрихкодом не должен молча его подменить. 404 и 502 — как без параметра.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/foods/barcode/[code]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { code } = await ctx.params;
  if (!/^\d{8,14}$/.test(code)) return Response.json({ error: "bad barcode" }, { status: 400 });

  const offOnly = new URL(req.url).searchParams.get("source") === "off";
  const own = offOnly ? null : await findOwnFoodByBarcode(db, session.user.id, code);
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
