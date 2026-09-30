import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import type { DB } from ".";
import { createEntry, NotFoundError } from "./entries";
import { upsertFood } from "./foods";
import {
  compositeFromEntries,
  deleteRecipe,
  getRecipe,
  listRecipes,
  saveComposite,
  saveTemplate,
  searchRecipes,
  templateFromEntry,
} from "./recipes";
import { entries, user } from "./schema";

let db: DB;
let close: () => Promise<void>;
const ME = "me";
const OTHER = "other";
const ids: Record<string, string> = {};
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values([
    { id: ME, name: "Me", email: "me@calo.test" },
    { id: OTHER, name: "Other", email: "other@calo.test" },
  ]);
  const foods = {
    cream: { kcal: 205, protein: 2.5, fat: 20, carbs: 3.8 },
    parmesan: { kcal: 392, protein: 35.75, fat: 25, carbs: 3.22 },
    pasta: { kcal: 356, protein: 14.5, fat: 1.6, carbs: 69.5 },
    oats: { kcal: 379, protein: 13, fat: 6.5, carbs: 68 },
  };
  for (const [ref, n] of Object.entries(foods)) {
    ids[ref] = (await upsertFood(db, { source: "manual", sourceRef: ref, nameRu: ref, nutrientsPer100g: n })).id;
  }
});
afterAll(() => close());

describe("составное блюдо", () => {
  it("паста: ингредиенты, вес готового блюда, порции", async () => {
    const r = await saveComposite(db, ME, {
      name: "Паста со сливками и пармезаном",
      ingredients: [
        { foodId: ids.cream, grams: 50 },
        { foodId: ids.parmesan, grams: 50 },
        { foodId: ids.pasta, grams: 100 },
      ],
      totalWeightG: 350,
      portions: 2,
    });
    ids.pastaDish = r.id;
    expect(r.kind).toBe("composite");
    expect(r.totalWeightG).toBe(350);
    expect(r.defaultPortionG).toBe(175);
    expect(r.nutrientsPer100g.kcal).toBeCloseTo(187);
    expect(r.ingredients.map((i) => [i.nameRu, i.grams])).toEqual([["cream", 50], ["parmesan", 50], ["pasta", 100]]);
  });

  it("редактирование пересчитывает, порядок ингредиентов сохраняется", async () => {
    const r = await saveComposite(
      db,
      ME,
      { name: "Паста со сливками", ingredients: [{ foodId: ids.pasta, grams: 100 }, { foodId: ids.cream, grams: 100 }] },
      ids.pastaDish,
    );
    expect(r.name).toBe("Паста со сливками");
    expect(r.totalWeightG).toBe(200);
    expect(r.nutrientsPer100g.kcal).toBeCloseTo(280.5);
    expect(r.ingredients.map((i) => i.nameRu)).toEqual(["pasta", "cream"]);
  });

  it("чужое блюдо не отредактировать и не удалить", async () => {
    await expect(saveComposite(db, OTHER, { name: "x", ingredients: [{ foodId: ids.pasta, grams: 1 }] }, ids.pastaDish)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await deleteRecipe(db, OTHER, ids.pastaDish)).toBe(false);
    expect(await getRecipe(db, OTHER, ids.pastaDish)).toBeNull();
  });
});

describe("шаблон и запись в дневник", () => {
  it("шаблон со своим КБЖУ; запись в дневник считает по нему и увеличивает счётчик", async () => {
    const t = await saveTemplate(db, ME, { name: "Сырники в кафе", per100g: { kcal: 250, protein: 15, fat: 12, carbs: 20 }, defaultPortionG: 220 });
    ids.syrniki = t.id;
    const e = await createEntry(db, ME, { recipeId: t.id, grams: 220, meal: "breakfast", eatenAt: at("2026-09-28T06:00:00Z") });
    expect(e.title).toBe("Сырники в кафе");
    expect(e.recipeId).toBe(t.id);
    expect(e.nutrients.kcal).toBeCloseTo(550);
    expect((await getRecipe(db, ME, t.id))?.useCount).toBe(1);
  });

  it("«Блюда»: наверху то, что едят в этот приём пищи", async () => {
    await createEntry(db, ME, { recipeId: ids.pastaDish, grams: 300, meal: "dinner", eatenAt: new Date() });
    await createEntry(db, ME, { recipeId: ids.syrniki, grams: 220, meal: "breakfast", eatenAt: new Date() });
    expect((await listRecipes(db, ME, "breakfast"))[0].name).toBe("Сырники в кафе");
    expect((await listRecipes(db, ME, "dinner"))[0].name).toBe("Паста со сливками");
    expect(await listRecipes(db, OTHER)).toEqual([]);
  });

  it("поиск по своим блюдам", async () => {
    expect((await searchRecipes(db, ME, ["паст"])).map((r) => r.name)).toEqual(["Паста со сливками"]);
    expect(await searchRecipes(db, OTHER, ["паст"])).toEqual([]);
  });
});

describe("сохранить как блюдо", () => {
  it("из записи продукта — блюдо из одного ингредиента с этой порцией", async () => {
    const e = await createEntry(db, ME, { foodId: ids.oats, grams: 60, meal: "breakfast", eatenAt: new Date() });
    const r = await templateFromEntry(db, ME, e.id, "Овсянка утром");
    expect(r).toMatchObject({ kind: "composite", defaultPortionG: 60 });
    expect(r.nutrientsPer100g.kcal).toBeCloseTo(379);
  });

  it("из записи блюда — шаблон по снимку", async () => {
    const e = await createEntry(db, ME, { recipeId: ids.syrniki, grams: 110, meal: "snack", eatenAt: new Date() });
    const r = await templateFromEntry(db, ME, e.id);
    expect(r).toMatchObject({ kind: "template", name: "Сырники в кафе", defaultPortionG: 110 });
    expect(r.nutrientsPer100g.kcal).toBeCloseTo(250);
  });

  it("из приёма пищи — «мой обычный завтрак»", async () => {
    const a = await createEntry(db, ME, { foodId: ids.oats, grams: 50, meal: "breakfast", eatenAt: at("2026-09-27T05:00:00Z") });
    const b = await createEntry(db, ME, { foodId: ids.cream, grams: 30, meal: "breakfast", eatenAt: at("2026-09-27T05:01:00Z") });
    const r = await compositeFromEntries(db, ME, [a.id, b.id], "Мой завтрак");
    expect(r.totalWeightG).toBe(80);
    expect(r.defaultPortionG).toBe(80);
    expect(r.ingredients.map((i) => i.nameRu)).toEqual(["oats", "cream"]);
    await expect(compositeFromEntries(db, OTHER, [a.id], "чужое")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("удаление блюда не трогает записи дневника — только отвязывает их", async () => {
    expect(await deleteRecipe(db, ME, ids.syrniki)).toBe(true);
    const rows = await db
      .select({ recipeId: entries.recipeId, kcal: entries.nutrients })
      .from(entries)
      .where(eq(entries.title, "Сырники в кафе"));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.recipeId === null)).toBe(true);
    await expect(createEntry(db, ME, { recipeId: ids.syrniki, grams: 1, meal: "snack", eatenAt: new Date() })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
