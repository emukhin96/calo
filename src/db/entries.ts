// Записи дневника. Нутриенты записи — снимок, посчитанный здесь, на сервере,
// из справочника: клиент присылает только продукт и граммы.
import { and, asc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { type NutrientVector, NUTRIENT_KEYS, scale } from "@/domain/nutrients";
import type { Meal } from "@/domain/day";
import type { DB } from ".";
import { entries, foods } from "./schema";

export type Entry = {
  id: string;
  eatenAt: Date;
  meal: Meal;
  title: string;
  grams: number;
  foodId: string | null;
  nutrients: NutrientVector;
};

const columns = {
  id: entries.id,
  eatenAt: entries.eatenAt,
  meal: entries.meal,
  title: entries.title,
  grams: entries.grams,
  foodId: entries.foodId,
  nutrients: entries.nutrients,
};

export async function listEntries(db: DB, ownerId: string, range: { start: Date; end: Date }): Promise<Entry[]> {
  return db
    .select(columns)
    .from(entries)
    .where(and(eq(entries.ownerId, ownerId), gte(entries.eatenAt, range.start), lt(entries.eatenAt, range.end)))
    .orderBy(asc(entries.eatenAt), asc(entries.createdAt));
}

export class NotFoundError extends Error {}

export async function createEntry(
  db: DB,
  ownerId: string,
  input: { foodId: string; grams: number; meal: Meal; eatenAt: Date },
): Promise<Entry> {
  // Продукт: общий справочник или свой — чужие личные продукты недоступны.
  const [food] = await db
    .select({ id: foods.id, nameRu: foods.nameRu, brand: foods.brand, per100g: foods.nutrientsPer100g })
    .from(foods)
    .where(and(eq(foods.id, input.foodId), or(isNull(foods.ownerId), eq(foods.ownerId, ownerId))));
  if (!food) throw new NotFoundError("food not found");

  const [row] = await db
    .insert(entries)
    .values({
      ownerId,
      eatenAt: input.eatenAt,
      meal: input.meal,
      inputMethod: "product",
      title: food.brand ? `${food.nameRu} · ${food.brand}` : food.nameRu,
      foodId: food.id,
      grams: input.grams,
      nutrients: scale(food.per100g, input.grams),
    })
    .returning(columns);
  return row;
}

/** Правка граммов пересчитывает снимок пропорционально — без обращения к справочнику. */
export async function updateEntry(
  db: DB,
  ownerId: string,
  id: string,
  patch: { grams?: number; meal?: Meal },
): Promise<Entry> {
  const [current] = await db
    .select(columns)
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.ownerId, ownerId)));
  if (!current) throw new NotFoundError("entry not found");

  const grams = patch.grams ?? current.grams;
  const nutrients =
    grams === current.grams || current.grams <= 0 ? current.nutrients : scale(per100gOf(current), grams);

  const [row] = await db
    .update(entries)
    .set({ grams, meal: patch.meal ?? current.meal, nutrients })
    .where(and(eq(entries.id, id), eq(entries.ownerId, ownerId)))
    .returning(columns);
  return row;
}

function per100gOf(e: Entry): NutrientVector {
  const out: NutrientVector = {};
  for (const k of NUTRIENT_KEYS) {
    const v = e.nutrients[k];
    if (v != null) out[k] = (v * 100) / e.grams;
    else if (k in e.nutrients) out[k] = null;
  }
  return out;
}

export async function deleteEntry(db: DB, ownerId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(entries)
    .where(and(eq(entries.id, id), eq(entries.ownerId, ownerId)))
    .returning({ id: entries.id });
  return rows.length > 0;
}

/** Недавние продукты владельца — для быстрого повторного добавления. */
export async function recentFoods(db: DB, ownerId: string, limit = 8) {
  return db
    .select({
      foodId: entries.foodId,
      title: sql<string>`max(${entries.title})`,
      lastGrams: sql<number>`(array_agg(${entries.grams} order by ${entries.eatenAt} desc))[1]`,
      lastAt: sql<Date>`max(${entries.eatenAt})`,
    })
    .from(entries)
    .where(and(eq(entries.ownerId, ownerId), sql`${entries.foodId} is not null`))
    .groupBy(entries.foodId)
    .orderBy(sql`max(${entries.eatenAt}) desc`)
    .limit(limit);
}
