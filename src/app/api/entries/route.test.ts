// POST /api/entries: будущий день → сегодня (lib/diary-date.ts newEntryTiming)
// вместе с createEntry на тестовой БД — как это сочетается с eatenAt, time и mealId.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { listEntries } from "@/db/entries";
import { upsertFood } from "@/db/foods";
import { user } from "@/db/schema";
import { zonedTime } from "@/domain/day";
import { POST } from "./route";

const ME = "me";
const TZ = "Europe/Moscow";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});
vi.mock("@/lib/api", () => ({ apiSession: async () => ({ session: { user: { id: "me" } }, error: null }) }));
vi.mock("@/lib/tz", () => ({ userTimeZone: async () => "Europe/Moscow" }));

/** «Сейчас» — 30 сентября, 18:00 по Москве; в Токио уже 1 октября. */
const NOW = zonedTime("2026-09-30", 18, 0, TZ);
const TODAY = "2026-09-30";
const TOMORROW = "2026-10-01";
const msk = (date: string, h: number, m = 0) => zonedTime(date, h, m, TZ);

let foodId: string;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await db.insert(user).values({ id: ME, name: "Me", email: "me@calo.test" });
  foodId = (await upsertFood(db, { source: "off", sourceRef: "staple:apple", nameRu: "Яблоко", nutrientsPer100g: { kcal: 52 } })).id;
});
afterAll(async () => {
  vi.useRealTimers();
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});

async function post(body: Record<string, unknown>) {
  const res = await POST(
    new Request("http://calo.test/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foodId, grams: 100, ...body }),
    }),
  );
  const json = await res.json();
  if (res.status !== 201) return { status: res.status, json, date: null, eatenAt: null };
  const [row] = (await listEntries(db, ME, "2000-01-01", "2100-01-01")).filter((e) => e.id === json.id);
  return { status: res.status, json, date: row.date, eatenAt: row.eatenAt };
}

describe("POST /api/entries: будущий день", () => {
  it("date позже сегодня — запись встаёт в сегодня, а не 400 (офлайн-очередь выбросила бы её)", async () => {
    const r = await post({ date: TOMORROW, mealName: "Ужин", eatenAt: NOW.toISOString() });
    expect(r.status).toBe(201);
    expect(r.date).toBe(TODAY);
    expect(r.eatenAt).toEqual(NOW);

    expect((await post({ date: "2027-01-01", mealName: "Ужин" })).date).toBe(TODAY);
  });

  it("телефон с поясом впереди: время «HH:MM» «завтрашнего» дня отброшено, eatenAt сегодня — взят", async () => {
    const eatenAt = new Date(NOW.getTime() - 5 * 60_000); // 00:05 в Токио, 17:55 в Москве
    const r = await post({ date: TOMORROW, time: "00:05", mealName: "Перекус", newMeal: true, eatenAt: eatenAt.toISOString() });
    expect(r.status).toBe(201);
    expect(r.date).toBe(TODAY);
    expect(r.eatenAt).toEqual(eatenAt); // а не 00:05 сегодняшнего утра
  });

  it("eatenAt на отброшенном дне не используется — ни с датой, ни без неё", async () => {
    const tomorrowAt = msk(TOMORROW, 0, 30); // через 6,5 часа — в пределах двух суток
    const withDate = await post({ date: TOMORROW, mealName: "Ужин", eatenAt: tomorrowAt.toISOString() });
    expect(withDate.date).toBe(TODAY);
    expect(withDate.eatenAt).toEqual(NOW);

    // Без date createEntry выбрал бы день по eatenAt — завтрашний.
    const noDate = await post({ mealName: "Ужин", eatenAt: tomorrowAt.toISOString() });
    expect(noDate.date).toBe(TODAY);
    expect(noDate.eatenAt).toEqual(NOW);
  });

  it("mealId: день решает приём — приём сегодня с «завтрашней» датой принимается", async () => {
    const first = await post({ date: TODAY, mealName: "Обед", newMeal: true });
    const r = await post({ date: TOMORROW, mealId: first.json.mealId });
    expect(r.status).toBe(201);
    expect(r.json.mealId).toBe(first.json.mealId);
    expect(r.date).toBe(TODAY);
  });

  it("mealId приёма прошлого дня с будущей датой — в этот приём (пояс сменился, пока запись ждала в очереди)", async () => {
    const past = await post({ date: "2026-09-28", mealName: "Обед", newMeal: true });
    const r = await post({ date: TOMORROW, mealId: past.json.mealId });
    expect(r.status).toBe(201);
    expect(r.json.mealId).toBe(past.json.mealId);
    expect(r.date).toBe("2026-09-28");
  });

  it("mealId другого прошлого дня — по-прежнему 400", async () => {
    const past = await post({ date: "2026-09-27", mealName: "Ужин", newMeal: true });
    expect((await post({ date: "2026-09-26", mealId: past.json.mealId })).status).toBe(400);
  });

  it("прошлый день — как прислали, со временем", async () => {
    const r = await post({ date: "2026-09-29", time: "08:15", mealName: "Завтрак", eatenAt: NOW.toISOString() });
    expect(r.date).toBe("2026-09-29");
    expect(r.eatenAt).toEqual(msk("2026-09-29", 8, 15));
  });
});
