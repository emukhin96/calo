import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { upsertFood } from "@/db/foods";
import { foods } from "@/db/schema";
import { apiSession } from "@/lib/api";
import { fetchOffProduct } from "@/lib/off";

/**
 * GET /api/foods/barcode/4607004012044 — продукт по штрихкоду: из своей базы,
 * иначе из Open Food Facts с сохранением в справочник (source=off).
 * Этим же путём сохраняется выбранный результат поиска в OFF.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/foods/barcode/[code]">) {
  const { error } = await apiSession(req);
  if (error) return error;
  const { code } = await ctx.params;
  if (!/^\d{8,14}$/.test(code)) return Response.json({ error: "bad barcode" }, { status: 400 });

  const [cached] = await db
    .select({ id: foods.id })
    .from(foods)
    .where(and(eq(foods.source, "off"), eq(foods.sourceRef, code)));
  try {
    const product = await fetchOffProduct(code);
    if (!product) {
      return cached ? Response.json({ id: cached.id }) : Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(await upsertFood(db, product));
  } catch (e) {
    console.error("[off] product", e);
    return cached ? Response.json({ id: cached.id }) : Response.json({ error: "Open Food Facts не отвечает" }, { status: 502 });
  }
}
