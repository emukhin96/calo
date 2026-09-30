// PUT /api/meals/order: порядок приёмов дня перетаскиванием — на тестовой БД.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { createEntry } from "@/db/entries";
import { upsertFood } from "@/db/foods";
import { listDayMeals } from "@/db/meals";
import { user } from "@/db/schema";
import { PUT } from "./route";

const ME = "me";
const OTHER = "other";
const D = "2026-09-29";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});
vi.mock("@/lib/api", () => ({ apiSession: async () => ({ session: { user: { id: "me" } }, error: null }) }));

let ids: string[] = [];

beforeAll(async () => {
  await db.insert(user).values([
    { id: ME, name: "Me", email: "me@calo.test" },
    { id: OTHER, name: "Other", email: "other@calo.test" },
  ]);
  const { id: foodId } = await upsertFood(db, { source: "off", sourceRef: "staple:apple", nameRu: "Яблоко", nutrientsPer100g: { kcal: 52 } });
  for (const mealName of ["Завтрак", "Обед", "Ужин"]) await createEntry(db, ME, { foodId, grams: 100, date: D, mealName });
  await createEntry(db, OTHER, { foodId, grams: 100, date: D, mealName: "Обед" });
  ids = (await listDayMeals(db, ME, D)).map((m) => m.id);
});
afterAll(async () => {
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});

const put = async (body: unknown) => {
  const res = await PUT(
    new Request("http://calo.test/api/meals/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
};

describe("PUT /api/meals/order", () => {
  it("новый порядок → { meals } по порядку, позиции 1…n", async () => {
    const [b, l, d] = ids;
    const r = await put({ date: D, ids: [d, b, l] });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      meals: [
        { id: d, name: "Ужин", position: 1 },
        { id: b, name: "Завтрак", position: 2 },
        { id: l, name: "Обед", position: 3 },
      ],
    });
    expect((await listDayMeals(db, ME, D)).map((m) => m.name)).toEqual(["Ужин", "Завтрак", "Обед"]);
    // повтор — то же самое
    expect(await put({ date: D, ids: [d, b, l] })).toEqual(r);
  });

  it("не тот набор приёмов — 409 с порядком как есть", async () => {
    const [theirs] = await listDayMeals(db, OTHER, D);
    const current = (await listDayMeals(db, ME, D)).map(({ id, name, position }) => ({ id, name, position }));
    for (const list of [ids.slice(1), [...ids, theirs.id], [ids[0], ids[0], ids[1]]]) {
      expect(await put({ date: D, ids: list })).toEqual({ status: 409, json: { error: "conflict", meals: current } });
    }
    // приёмы другого дня
    expect((await put({ date: "2026-09-28", ids })).json).toEqual({ error: "conflict", meals: [] });
    expect((await listDayMeals(db, OTHER, D)).map((m) => m.id)).toEqual([theirs.id]);
  });

  it("неверное тело — 400", async () => {
    for (const body of [null, {}, { date: D }, { date: D, ids: [] }, { date: "2026-02-30", ids }, { date: D, ids: ["x"] }]) {
      expect((await put(body)).status).toBe(400);
    }
  });
});
