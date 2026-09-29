import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import type { DB } from ".";
import { type FoodResult, searchFoods, upsertFood } from "./foods";
import { entries, user } from "./schema";
import { seedFoods } from "./seed-foods";

// Критерий готовности этапа 1 (docs/PLAN.md): типичные запросы находят верные
// продукты на настоящем справочнике seed/foods.
let db: DB;
let close: () => Promise<void>;
const OWNER = "test-user";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: OWNER, name: "Test", email: "t@calo.test" });
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
