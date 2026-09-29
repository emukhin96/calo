import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { seedFoods } from "@/db/seed-foods";
import { createTestDb } from "@/test/db";
import { matchItems } from "./match";

let db: DB;
let close: () => Promise<void>;
const OWNER = "u1";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: OWNER, name: "U", email: "u@calo.test" });
  await seedFoods(db, path.resolve(__dirname, "../../seed/foods"));
});
afterAll(() => close());

describe("matchItems", () => {
  it("подбирает топ-3 кандидата и оставляет граммы", async () => {
    const [item] = await matchItems(db, OWNER, [{ name: "сливки 20%", amount: { grams: 50 }, sourceText: "50 г сливок 20%" }]);
    expect(item.grams).toBe(50);
    expect(item.candidates.length).toBeGreaterThan(0);
    expect(item.candidates.length).toBeLessThanOrEqual(3);
    expect(item.candidates[0].nameRu.toLowerCase()).toContain("сливки");
  });

  it("штуки переводит в граммы через порцию найденного продукта", async () => {
    const [egg] = await matchItems(db, OWNER, [{ name: "яйцо", amount: { pieces: 2 }, sourceText: "яйцо 2 шт" }]);
    expect(egg.pieces).toBe(2);
    if (egg.candidates[0]?.defaultPortionG) expect(egg.grams).toBe(2 * egg.candidates[0].defaultPortionG);
    else expect(egg.grams).toBeNull();
  });

  it("бренд не мешает найти продукт, длинное название — падает до ключевого слова", async () => {
    const [a, b] = await matchItems(db, OWNER, [
      { name: "творог 5%", brand: "Простоквашино", amount: { grams: 180 }, sourceText: "" },
      { name: "пармезан выдержанный тёртый", amount: { grams: 30 }, sourceText: "" },
    ]);
    expect(a.candidates[0].nameRu.toLowerCase()).toContain("творог");
    expect(b.candidates.some((c) => c.nameRu.toLowerCase().includes("пармезан"))).toBe(true);
  });

  it("несуществующий продукт — без кандидатов, граммы сохраняются", async () => {
    const [x] = await matchItems(db, OWNER, [{ name: "ъъъъъ", amount: { grams: 10 }, sourceText: "" }]);
    expect(x.candidates).toEqual([]);
    expect(x.grams).toBe(10);
  });
});
