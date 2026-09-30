// «Мои блюда»: составные рецепты (ингредиенты из справочника) и шаблоны
// (своё КБЖУ, например из меню кафе). nutrients_per_100g — кэш расчёта,
// пересчитывается при каждом сохранении; прошлые записи дневника не меняются.
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Meal } from "@/domain/day";
import { type NutrientVector, per100gOf } from "@/domain/nutrients";
import { computeRecipe } from "@/domain/recipe";
import type { DB } from ".";
import { NotFoundError } from "./entries";
import { entries, foods, recipeIngredients, recipes } from "./schema";

export type RecipeKind = "template" | "composite";

export type RecipeSummary = {
  id: string;
  name: string;
  kind: RecipeKind;
  nutrientsPer100g: NutrientVector;
  defaultPortionG: number | null;
  totalWeightG: number | null;
  useCount: number;
};

export type RecipeIngredientView = {
  foodId: string;
  nameRu: string;
  brand: string | null;
  grams: number;
  per100g: NutrientVector;
  portionG: number | null;
  portionLabel: string | null;
};

export type RecipeDetail = RecipeSummary & { ingredients: RecipeIngredientView[] };

const summaryColumns = {
  id: recipes.id,
  name: recipes.name,
  kind: recipes.kind,
  nutrientsPer100g: recipes.nutrientsPer100g,
  defaultPortionG: recipes.defaultPortionG,
  totalWeightG: recipes.totalWeightG,
  useCount: recipes.useCount,
};

/**
 * Мои блюда, самые вероятные сверху: сколько раз блюдо ели в этот приём пищи
 * за 90 дней (×3) + сколько раз вообще, затем недавние, затем по алфавиту.
 */
export async function listRecipes(db: DB, ownerId: string, meal?: Meal): Promise<RecipeSummary[]> {
  const usage = db
    .select({
      recipeId: entries.recipeId,
      uses: sql<number>`count(*)`.as("uses"),
      mealUses: sql<number>`count(*) filter (where ${entries.meal} = ${meal ?? null})`.as("meal_uses"),
    })
    .from(entries)
    .where(and(eq(entries.ownerId, ownerId), sql`${entries.recipeId} is not null`, sql`${entries.eatenAt} > now() - interval '90 days'`))
    .groupBy(entries.recipeId)
    .as("usage");

  return db
    .select(summaryColumns)
    .from(recipes)
    .leftJoin(usage, eq(usage.recipeId, recipes.id))
    .where(eq(recipes.ownerId, ownerId))
    .orderBy(
      sql`coalesce(${usage.mealUses}, 0) * 3 + coalesce(${usage.uses}, 0) desc`,
      sql`${recipes.lastUsedAt} desc nulls last`,
      asc(recipes.name),
    );
}

/** Поиск по названию своих блюд — каждое слово запроса должно встретиться. */
export async function searchRecipes(db: DB, ownerId: string, tokens: string[], limit = 10): Promise<RecipeSummary[]> {
  if (tokens.length === 0) return [];
  return db
    .select(summaryColumns)
    .from(recipes)
    .where(and(eq(recipes.ownerId, ownerId), ...tokens.map((t) => ilike(recipes.name, `%${t}%`))))
    .orderBy(desc(recipes.useCount), asc(recipes.name))
    .limit(limit);
}

export async function getRecipe(db: DB, ownerId: string, id: string): Promise<RecipeDetail | null> {
  const [r] = await db
    .select(summaryColumns)
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.ownerId, ownerId)));
  if (!r) return null;
  const ingredients = await db
    .select({
      foodId: foods.id,
      nameRu: foods.nameRu,
      brand: foods.brand,
      grams: recipeIngredients.grams,
      per100g: foods.nutrientsPer100g,
      portionG: foods.defaultPortionG,
      portionLabel: foods.portionLabel,
    })
    .from(recipeIngredients)
    .innerJoin(foods, eq(foods.id, recipeIngredients.foodId))
    .where(eq(recipeIngredients.recipeId, id))
    .orderBy(asc(recipeIngredients.rawText), asc(recipeIngredients.id));
  return { ...r, ingredients };
}

export type CompositeInput = {
  name: string;
  ingredients: { foodId: string; grams: number }[];
  totalWeightG?: number | null;
  portions?: number | null;
};

/** Создать или обновить составное блюдо. Ингредиенты — только доступные продукты. */
export async function saveComposite(db: DB, ownerId: string, input: CompositeInput, id?: string): Promise<RecipeDetail> {
  const ids = [...new Set(input.ingredients.map((i) => i.foodId))];
  const found = await db
    .select({ id: foods.id, per100g: foods.nutrientsPer100g })
    .from(foods)
    .where(and(inArray(foods.id, ids), or(isNull(foods.ownerId), eq(foods.ownerId, ownerId))));
  if (found.length !== ids.length) throw new NotFoundError("food not found");
  const per100gById = new Map(found.map((f) => [f.id, f.per100g]));

  const r = computeRecipe(
    input.ingredients.map((i) => ({ per100g: per100gById.get(i.foodId)!, grams: i.grams })),
    { totalWeightG: input.totalWeightG, portions: input.portions },
  );
  const values = {
    name: input.name.trim(),
    kind: "composite" as const,
    totalWeightG: r.totalWeightG,
    nutrientsPer100g: r.per100g,
    defaultPortionG: r.portionG ?? r.totalWeightG,
  };

  const recipeId = await db.transaction(async (tx) => {
    let rid = id;
    if (rid) {
      const updated = await tx
        .update(recipes)
        .set(values)
        .where(and(eq(recipes.id, rid), eq(recipes.ownerId, ownerId)))
        .returning({ id: recipes.id });
      if (updated.length === 0) throw new NotFoundError("recipe not found");
      await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, rid));
    } else {
      [{ id: rid }] = await tx.insert(recipes).values({ ownerId, ...values }).returning({ id: recipes.id });
    }
    // raw_text хранит порядковый номер — порядок ингредиентов как ввёл пользователь.
    await tx.insert(recipeIngredients).values(
      input.ingredients.map((i, n) => ({ recipeId: rid!, foodId: i.foodId, grams: i.grams, rawText: String(n).padStart(3, "0") })),
    );
    return rid!;
  });
  return (await getRecipe(db, ownerId, recipeId))!;
}

export type TemplateInput = { name: string; per100g: NutrientVector; defaultPortionG?: number | null };

/** Шаблон: своё КБЖУ на 100 г (из меню, с упаковки) и обычная порция. */
export async function saveTemplate(db: DB, ownerId: string, input: TemplateInput, id?: string): Promise<RecipeDetail> {
  const values = {
    name: input.name.trim(),
    kind: "template" as const,
    totalWeightG: null,
    nutrientsPer100g: input.per100g,
    defaultPortionG: input.defaultPortionG ?? null,
  };
  let rid = id;
  if (rid) {
    const updated = await db
      .update(recipes)
      .set(values)
      .where(and(eq(recipes.id, rid), eq(recipes.ownerId, ownerId)))
      .returning({ id: recipes.id });
    if (updated.length === 0) throw new NotFoundError("recipe not found");
  } else {
    [{ id: rid }] = await db.insert(recipes).values({ ownerId, ...values }).returning({ id: recipes.id });
  }
  return (await getRecipe(db, ownerId, rid!))!;
}

export async function deleteRecipe(db: DB, ownerId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.ownerId, ownerId)))
    .returning({ id: recipes.id });
  return rows.length > 0;
}

/** «Сохранить как блюдо» из записи дневника: шаблон с её КБЖУ и порцией. */
export async function templateFromEntry(db: DB, ownerId: string, entryId: string, name?: string): Promise<RecipeDetail> {
  const [e] = await db
    .select({ title: entries.title, grams: entries.grams, nutrients: entries.nutrients, foodId: entries.foodId })
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.ownerId, ownerId)));
  if (!e) throw new NotFoundError("entry not found");
  // Из продукта справочника — составное блюдо из одного ингредиента: витамины
  // останутся связаны с продуктом. Иначе (запись из блюда) — шаблон по снимку.
  if (e.foodId) {
    return saveComposite(db, ownerId, { name: name ?? e.title, ingredients: [{ foodId: e.foodId, grams: e.grams }], portions: 1 });
  }
  return saveTemplate(db, ownerId, { name: name ?? e.title, per100g: per100gOf(e.nutrients, e.grams), defaultPortionG: e.grams });
}

/** «Сохранить приём пищи как блюдо»: «мой обычный завтрак» — одной кнопкой в следующий раз. */
export async function compositeFromEntries(
  db: DB,
  ownerId: string,
  entryIds: string[],
  name: string,
): Promise<RecipeDetail> {
  const rows = await db
    .select({ foodId: entries.foodId, grams: entries.grams })
    .from(entries)
    .where(and(eq(entries.ownerId, ownerId), inArray(entries.id, entryIds)))
    .orderBy(asc(entries.eatenAt), asc(entries.createdAt));
  const ingredients = rows.filter((r): r is { foodId: string; grams: number } => r.foodId != null);
  if (ingredients.length === 0) throw new NotFoundError("no product entries");
  return saveComposite(db, ownerId, { name, ingredients, portions: 1 });
}
