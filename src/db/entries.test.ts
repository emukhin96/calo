import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayRange } from "@/domain/day";
import { sum } from "@/domain/nutrients";
import { createTestDb } from "@/test/db";
import type { DB } from ".";
import { createEntry, deleteEntry, listEntries, NotFoundError, recentFoods, updateEntry } from "./entries";
import { upsertFood } from "./foods";
import { foods, user } from "./schema";

let db: DB;
let close: () => Promise<void>;
let tvorogId: string;
let privateFoodId: string;
const ME = "me";
const OTHER = "other";
const TZ = "Europe/Moscow";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values([
    { id: ME, name: "Me", email: "me@calo.test" },
    { id: OTHER, name: "Other", email: "other@calo.test" },
  ]);
  tvorogId = (
    await upsertFood(db, {
      source: "off",
      sourceRef: "staple:tvorog-5",
      nameRu: "Творог 5%",
      nutrientsPer100g: { kcal: 121, protein: 16, fat: 5, carbs: 3, vitD: null },
    })
  ).id;
  [{ id: privateFoodId }] = await db
    .insert(foods)
    .values({ ownerId: OTHER, nameRu: "Бабушкин пирог", source: "manual", nutrientsPer100g: { kcal: 300 } })
    .returning({ id: foods.id });
});
afterAll(() => close());

describe("дневник", () => {
  it("запись считает нутриенты на сервере и попадает в свой день", async () => {
    const e = await createEntry(db, ME, {
      foodId: tvorogId,
      grams: 180,
      meal: "breakfast",
      eatenAt: new Date("2026-09-29T05:30:00Z"), // 08:30 МСК
    });
    expect(e.title).toBe("Творог 5%");
    expect(e.nutrients.kcal).toBeCloseTo(217.8);
    expect(e.nutrients.protein).toBeCloseTo(28.8);
    expect(e.nutrients.vitD).toBeNull();

    const day = await listEntries(db, ME, dayRange("2026-09-29", TZ));
    expect(day.map((x) => x.id)).toContain(e.id);
    expect(await listEntries(db, ME, dayRange("2026-09-28", TZ))).toHaveLength(0);
  });

  it("поздний ужин 23:30 МСК — тот же местный день, хотя по UTC 20:30", async () => {
    await createEntry(db, ME, { foodId: tvorogId, grams: 100, meal: "dinner", eatenAt: new Date("2026-09-29T20:30:00Z") });
    const day = await listEntries(db, ME, dayRange("2026-09-29", TZ));
    expect(day).toHaveLength(2);
    expect(sum(day.map((x) => x.nutrients)).kcal).toBeCloseTo(338.8);
  });

  it("правка граммов пересчитывает снимок пропорционально", async () => {
    const e = await createEntry(db, ME, { foodId: tvorogId, grams: 200, meal: "snack", eatenAt: new Date("2026-09-30T12:00:00Z") });
    const upd = await updateEntry(db, ME, e.id, { grams: 50, meal: "lunch" });
    expect(upd.grams).toBe(50);
    expect(upd.meal).toBe("lunch");
    expect(upd.nutrients.kcal).toBeCloseTo(60.5);
    expect(upd.nutrients.vitD).toBeNull();
  });

  it("чужие записи и личные продукты недоступны", async () => {
    const [mine] = await listEntries(db, ME, dayRange("2026-09-29", TZ));
    await expect(updateEntry(db, OTHER, mine.id, { grams: 1 })).rejects.toBeInstanceOf(NotFoundError);
    expect(await deleteEntry(db, OTHER, mine.id)).toBe(false);
    await expect(
      createEntry(db, ME, { foodId: privateFoodId, grams: 100, meal: "lunch", eatenAt: new Date() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("удаление и недавние продукты", async () => {
    const recent = await recentFoods(db, ME);
    expect(recent[0]).toMatchObject({ foodId: tvorogId, lastGrams: 50 });
    const [first] = await listEntries(db, ME, dayRange("2026-09-29", TZ));
    expect(await deleteEntry(db, ME, first.id)).toBe(true);
    expect(await listEntries(db, ME, dayRange("2026-09-29", TZ))).toHaveLength(1);
  });
});
