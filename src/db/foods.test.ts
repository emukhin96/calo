import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import type { DB } from ".";
import { createOwnFood, findOwnFoodByBarcode, type FoodResult, getFood, searchFoods, upsertFood } from "./foods";
import { entries, user } from "./schema";
import { seedFoods } from "./seed-foods";

// Критерий готовности этапа 1 (docs/PLAN.md): типичные запросы находят верные
// продукты на настоящем справочнике seed/foods.
let db: DB;
let close: () => Promise<void>;
const OWNER = "test-user";
const OTHER = "other-user";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values([
    { id: OWNER, name: "Test", email: "t@calo.test" },
    { id: OTHER, name: "Other", email: "o@calo.test" },
  ]);
  await seedFoods(db, path.resolve(__dirname, "../../seed/foods"));
});
afterAll(() => close());

const names = (items: FoodResult[], n = 5) => items.slice(0, n).map((f) => f.nameRu.toLowerCase());

describe("searchFoods на справочнике", () => {
  it("«сливки 20» → сливки 20%", async () => {
    const top = names(await searchFoods(db, OWNER, "сливки 20"), 3);
    expect(top.some((n) => n.includes("сливки") && n.includes("20"))).toBe(true);
  });

  it("«пармезан» → сыр пармезан", async () => {
    expect(names(await searchFoods(db, OWNER, "пармезан"), 3).every((n) => n.includes("пармезан"))).toBe(true);
  });

  it("падеж и опечатка: «пармезана», «пармизан»", async () => {
    expect(names(await searchFoods(db, OWNER, "пармезана"), 1)[0]).toContain("пармезан");
    expect(names(await searchFoods(db, OWNER, "пармизан"), 1)[0]).toContain("пармезан");
  });

  it("«гречка» → гречневая крупа", async () => {
    expect(names(await searchFoods(db, OWNER, "гречка"), 3).some((n) => n.includes("греч"))).toBe(true);
  });

  it("«творог 5%» → базовый творог 5% из OFF-медианы", async () => {
    const [first] = await searchFoods(db, OWNER, "творог 5%");
    expect(first.nameRu).toBe("Творог 5%");
    expect(first.nutrientsPer100g.protein).toBeGreaterThan(12);
  });

  it("«куриная грудка» находит курицу", async () => {
    expect(names(await searchFoods(db, OWNER, "куриная грудка"), 3).some((n) => n.includes("кур"))).toBe(true);
  });

  it("английский запрос тоже работает: «parmesan»", async () => {
    expect(names(await searchFoods(db, OWNER, "parmesan"), 1)[0]).toContain("пармезан");
  });

  it("падежи прилагательных: «банан сырой» → бананы, «яблоко» → яблоки сырые в первой тройке", async () => {
    expect(names(await searchFoods(db, OWNER, "банан сырой"), 1)[0]).toMatch(/^бананы/);
    expect(names(await searchFoods(db, OWNER, "яблоко"), 3).some((n) => n.startsWith("яблоки") && n.includes("сыр"))).toBe(true);
  });

  it("пустой и бессмысленный запрос", async () => {
    expect(await searchFoods(db, OWNER, "  ")).toEqual([]);
    expect(await searchFoods(db, OWNER, "ъъъъъ")).toEqual([]);
  });
});

describe("ранжирование", () => {
  it("то, что уже ели, поднимается наверх", async () => {
    const before = await searchFoods(db, OWNER, "куриная грудка");
    const pick = before[before.length > 3 ? 3 : before.length - 1];
    await db.insert(entries).values({
      ownerId: OWNER, eatenAt: new Date(), meal: "lunch", inputMethod: "product",
      title: pick.nameRu, foodId: pick.id, grams: 150, nutrients: {},
    });
    expect((await searchFoods(db, OWNER, "куриная грудка"))[0].id).toBe(pick.id);
  });

  it("яйцо: у продукта есть вес штуки из USDA", async () => {
    const egg = (await searchFoods(db, OWNER, "яйцо куриное сырое")).find((f) => f.defaultPortionG);
    expect(egg?.defaultPortionG).toBeGreaterThanOrEqual(40);
    expect(egg?.portionLabel).toMatch(/^1 шт/);
  });
});

describe("upsertFood (OFF)", () => {
  it("сохраняет и находит брендовый продукт, повторная запись не дублирует", async () => {
    const item = {
      source: "off" as const,
      sourceRef: "8008343200134",
      nameRu: "Spaghetti n°3",
      brand: "Rummo",
      nutrientsPer100g: { kcal: 356, protein: 14, fat: 1.5, carbs: 70 },
    };
    await upsertFood(db, item);
    await upsertFood(db, { ...item, nutrientsPer100g: { ...item.nutrientsPer100g, kcal: 357 } });
    const found = await searchFoods(db, OWNER, "rummo");
    expect(found.filter((f) => f.sourceRef === "8008343200134")).toHaveLength(1);
    expect(found[0].nutrientsPer100g.kcal).toBe(357);
  });
});

describe("createOwnFood (КБЖУ с упаковки)", () => {
  const yogurt = {
    nameRu: "Йогурт греческий 2%",
    brand: "Эпика",
    barcode: "4640003390224",
    nutrientsPer100g: { kcal: 66, protein: 8.2, fat: 2, carbs: 3.9 },
    defaultPortionG: 130,
  };

  it("сохраняет свой продукт и находит его поиском — только у владельца", async () => {
    const saved = await createOwnFood(db, OWNER, yogurt);
    expect(saved).toMatchObject({
      nameRu: "Йогурт греческий 2%",
      brand: "Эпика",
      source: "manual",
      sourceRef: "4640003390224",
      own: true,
      defaultPortionG: 130,
      portionLabel: "порция 130 г",
    });
    expect((await searchFoods(db, OWNER, "йогурт эпика"))[0].id).toBe(saved.id);
    expect((await searchFoods(db, OWNER, "греческий йогурт")).map((f) => f.id)).toContain(saved.id);
    expect((await searchFoods(db, OTHER, "йогурт эпика")).map((f) => f.id)).not.toContain(saved.id);
    expect(await getFood(db, OTHER, saved.id)).toBeNull();
  });

  it("штрихкод: свой продукт находится, чужой — нет", async () => {
    const mine = await findOwnFoodByBarcode(db, OWNER, "4640003390224");
    expect(mine?.nameRu).toBe("Йогурт греческий 2%");
    expect(await findOwnFoodByBarcode(db, OTHER, "4640003390224")).toBeNull();
    expect(await findOwnFoodByBarcode(db, OWNER, "0000000000000")).toBeNull();
  });

  it("тот же код у другого человека не конфликтует; повторное сохранение обновляет", async () => {
    const theirs = await createOwnFood(db, OTHER, { ...yogurt, nameRu: "Йогурт", nutrientsPer100g: { kcal: 70, protein: 8, fat: 2.5, carbs: 4 } });
    const first = await findOwnFoodByBarcode(db, OWNER, "4640003390224");
    const again = await createOwnFood(db, OWNER, { ...yogurt, nutrientsPer100g: { kcal: 68, protein: 8.5, fat: 2, carbs: 4 } });
    expect(again.id).toBe(first?.id);
    expect(again.nutrientsPer100g.kcal).toBe(68);
    expect(theirs.id).not.toBe(again.id);
    expect((await findOwnFoodByBarcode(db, OTHER, "4640003390224"))?.id).toBe(theirs.id);
    expect((await findOwnFoodByBarcode(db, OWNER, "4640003390224"))?.nutrientsPer100g.kcal).toBe(68);
  });

  it("без штрихкода — всегда новый продукт, пустой бренд не сохраняется", async () => {
    const oil = { nameRu: "Масло сливочное 82,5% ", brand: " ", nutrientsPer100g: { kcal: 748, protein: 0.5, fat: 82.5, carbs: 0.8 } };
    const a = await createOwnFood(db, OWNER, oil);
    const b = await createOwnFood(db, OWNER, oil);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ nameRu: "Масло сливочное 82,5%", brand: null, sourceRef: null, defaultPortionG: null, portionLabel: null });
    expect((await searchFoods(db, OWNER, "масло сливочное 82.5")).slice(0, 2).map((f) => f.id).sort()).toEqual([a.id, b.id].sort());
    const cube = await createOwnFood(db, OWNER, { ...oil, nameRu: "Бульон кубик", defaultPortionG: 12.5 });
    expect(cube.portionLabel).toBe("порция 12,5 г");
  });
});
