import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zonedTime } from "@/domain/day";
import { createTestDb } from "@/test/db";
import type { DB } from ".";
import { createEntry, loadDayData } from "./entries";
import { BadRequestError, NotFoundError } from "./errors";
import { deleteDayMeal, insertDayMeal, listDayMeals, updateDayMeal } from "./meals";
import { dayMeals, entries, foods, user } from "./schema";

let db: DB;
let close: () => Promise<void>;
let foodId: string;
const ME = "me";
const OTHER = "other";
const TZ = "Europe/Moscow";
const ctx = { tz: TZ, now: new Date("2026-10-15T09:00:00Z") };
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTime(date, h, m, TZ);
};
const add = (date: string, mealName: string, owner = ME, time?: string) =>
  createEntry(db, owner, { foodId, grams: 100, date, mealName, time }, ctx);
const names = async (date: string, owner = ME) => (await listDayMeals(db, owner, date)).map((m) => m.name);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values([
    { id: ME, name: "Me", email: "me@calo.test" },
    { id: OTHER, name: "Other", email: "other@calo.test" },
  ]);
  [{ id: foodId }] = await db
    .insert(foods)
    .values({ nameRu: "Каша", source: "manual", nutrientsPer100g: { kcal: 100 } })
    .returning({ id: foods.id });
});
afterAll(() => close());

describe("выше / ниже", () => {
  const D = "2026-09-01";

  it("меняется местами с соседом; у края — ничего", async () => {
    const b = await add(D, "Завтрак");
    await add(D, "Обед");
    const d = await add(D, "Ужин");
    const out = await updateDayMeal(db, ME, d.mealId, { move: "up" }, TZ);
    expect(out.map((m) => m.name)).toEqual(["Завтрак", "Ужин", "Обед"]);
    expect(out.map((m) => m.position)).toEqual([...out.map((m) => m.position)].sort((x, y) => x - y));
    expect((await updateDayMeal(db, ME, b.mealId, { move: "up" }, TZ)).map((m) => m.name)).toEqual(["Завтрак", "Ужин", "Обед"]);
    expect((await updateDayMeal(db, ME, b.mealId, { move: "down" }, TZ)).map((m) => m.name)).toEqual(["Ужин", "Завтрак", "Обед"]);
    const [, , last] = await listDayMeals(db, ME, D);
    expect((await updateDayMeal(db, ME, last.id, { move: "down" }, TZ)).map((m) => m.name)).toEqual(["Ужин", "Завтрак", "Обед"]);
    // порядок дня — тот же и на экране дня
    expect((await loadDayData(db, ME, D, TZ)).meals.map((m) => m.name)).toEqual(["Ужин", "Завтрак", "Обед"]);
  });

  it("новый приём после перестановки встаёт по списку среди остальных", async () => {
    await add(D, "Перекус");
    // «Ужин» (выше всех) в сравнении участвует: перекус — перед первым, кто дальше в списке
    expect(await names(D)).toEqual(["Перекус", "Ужин", "Завтрак", "Обед"]);
  });
});

describe("переименование и время приёма", () => {
  const D = "2026-09-02";

  it("переименование пересчитывает вид записей", async () => {
    const e1 = await add(D, "Перекус", ME, "10:30");
    await add(D, "Перекус", ME, "10:40");
    const out = await updateDayMeal(db, ME, e1.mealId, { name: "  второй завтрак " }, TZ);
    expect(out).toEqual([{ id: e1.mealId, name: "Второй завтрак", position: 1 }]);
    const [meal] = (await loadDayData(db, ME, D, TZ)).meals;
    expect(meal.entries.map((e) => [e.mealName, e.meal])).toEqual([
      ["Второй завтрак", "breakfast"],
      ["Второй завтрак", "breakfast"],
    ]);
    await updateDayMeal(db, ME, e1.mealId, { name: "обед" }, TZ);
    const kinds = await db.select({ meal: entries.meal }).from(entries).where(eq(entries.mealId, e1.mealId));
    expect(kinds.map((k) => k.meal)).toEqual(["lunch", "lunch"]);
  });

  it("время: все записи приёма — на это время его дня", async () => {
    const [meal] = await listDayMeals(db, ME, D);
    await updateDayMeal(db, ME, meal.id, { time: "12:15", name: "Кофе" }, TZ);
    const [view] = (await loadDayData(db, ME, D, TZ)).meals;
    expect(view.time).toBe("12:15");
    expect(view.entries.map((e) => e.eatenAt)).toEqual([at(D, "12:15"), at(D, "12:15")]);
    expect(view.entries.map((e) => e.meal)).toEqual(["lunch", "lunch"]); // своё название — вид по часу
  });

  it("пустое название или неверное время — 400; чужой приём — 404", async () => {
    const [meal] = await listDayMeals(db, ME, D);
    await expect(updateDayMeal(db, ME, meal.id, { name: " ​ " }, TZ)).rejects.toBeInstanceOf(BadRequestError);
    await expect(updateDayMeal(db, ME, meal.id, { time: "25:00" }, TZ)).rejects.toBeInstanceOf(BadRequestError);
    await expect(updateDayMeal(db, OTHER, meal.id, { name: "Взлом" }, TZ)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateDayMeal(db, OTHER, meal.id, { move: "up" }, TZ)).rejects.toBeInstanceOf(NotFoundError);
    expect(await names(D)).toEqual(["Кофе"]);
  });
});

describe("удаление приёма", () => {
  const D = "2026-09-03";

  it("вместе с записями; возвращает id удалённых", async () => {
    const a = await add(D, "Обед");
    const b = await add(D, "Обед");
    const keep = await add(D, "Ужин");
    const theirs = await add(D, "Обед", OTHER);
    await expect(deleteDayMeal(db, OTHER, a.mealId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await deleteDayMeal(db, ME, a.mealId)).sort()).toEqual([a.id, b.id].sort());
    const day = await loadDayData(db, ME, D, TZ);
    expect(day.meals.map((m) => m.name)).toEqual(["Ужин"]);
    expect(day.entries.map((e) => e.id)).toEqual([keep.id]);
    expect((await loadDayData(db, OTHER, D, TZ)).entries.map((e) => e.id)).toEqual([theirs.id]);
    await expect(deleteDayMeal(db, ME, a.mealId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("позиции", () => {
  it("дробные позиции исчерпались — день перенумеровывается, порядок сохраняется", async () => {
    const D = "2026-09-04";
    const close1 = 1;
    const close2 = 1 + Number.EPSILON; // между ними другого double нет
    await db.insert(dayMeals).values([
      { ownerId: ME, date: D, name: "Завтрак", position: close1 },
      { ownerId: ME, date: D, name: "Ужин", position: close2 },
    ]);
    const lunch = await insertDayMeal(db, ME, D, "Обед", ["Завтрак", "Обед", "Ужин"]);
    const day = await listDayMeals(db, ME, D);
    expect(day.map((m) => m.name)).toEqual(["Завтрак", "Обед", "Ужин"]);
    expect(day.map((m) => m.position)).toEqual([1, 1.5, 2]);
    expect(lunch.position).toBe(1.5);
  });

  it("много вставок подряд между одними соседями", async () => {
    const D = "2026-09-05";
    const plan = ["Завтрак", ...Array(80).fill("Перекус"), "Ужин"];
    await insertDayMeal(db, ME, D, "Завтрак", plan);
    await insertDayMeal(db, ME, D, "Ужин", plan);
    for (let i = 0; i < 70; i++) await insertDayMeal(db, ME, D, "Перекус", plan);
    const day = await listDayMeals(db, ME, D);
    expect(day).toHaveLength(72);
    expect(day[0].name).toBe("Завтрак");
    expect(day.at(-1)!.name).toBe("Ужин");
    expect(new Set(day.map((m) => m.position)).size).toBe(72);
  });
});
