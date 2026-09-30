import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zonedTime } from "@/domain/day";
import { createTestDb } from "@/test/db";
import type { DB } from ".";
import {
  BadRequestError,
  createEntry,
  deleteEntry,
  kcalByDay,
  listEntries,
  loadDayData,
  NotFoundError,
  recentFoods,
  updateEntry,
} from "./entries";
import { upsertFood } from "./foods";
import { listDayMeals } from "./meals";
import { saveProfile } from "./profile";
import { dayMeals, foods, profiles, user } from "./schema";

let db: DB;
let close: () => Promise<void>;
let tvorogId: string;
let privateFoodId: string;
const ME = "me";
const OTHER = "other";
const TZ = "Europe/Moscow";
const ctx = (now = new Date()) => ({ tz: TZ, now });

/** Местное время дня date в Москве. */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTime(date, h, m, TZ);
};
const day = (date: string, owner = ME) => loadDayData(db, owner, date, TZ);
const names = async (date: string, owner = ME) => (await listDayMeals(db, owner, date)).map((m) => m.name);

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
  const D = "2026-09-29";

  it("запись считает нутриенты на сервере и попадает в свой день", async () => {
    const e = await createEntry(db, ME, { foodId: tvorogId, grams: 180, meal: "breakfast", eatenAt: at(D, "08:30") }, ctx());
    expect(e.title).toBe("Творог 5%");
    expect(e.mealName).toBe("Завтрак"); // старый клиент: название — по виду
    expect(e.meal).toBe("breakfast");
    expect(e.nutrients.kcal).toBeCloseTo(217.8);
    expect(e.nutrients.protein).toBeCloseTo(28.8);
    expect(e.nutrients.vitD).toBeNull();

    const { entries } = await day(D);
    expect(entries.map((x) => x.id)).toContain(e.id);
    expect((await day("2026-09-28")).entries).toHaveLength(0);
  });

  it("поздний ужин 23:30 МСК — тот же местный день, хотя по UTC 20:30", async () => {
    const e = await createEntry(db, ME, { foodId: tvorogId, grams: 100, meal: "dinner", eatenAt: new Date("2026-09-29T20:30:00Z") }, ctx());
    const d = await day(D);
    expect(d.entries).toHaveLength(2);
    expect(d.totals.kcal).toBeCloseTo(338.8);
    expect(d.meals.map((m) => m.name)).toEqual(["Завтрак", "Ужин"]);
    expect(d.meals[1].entries.map((x) => x.id)).toEqual([e.id]);
    expect(await listEntries(db, ME, D, D)).toHaveLength(2);
  });

  it("правка граммов пересчитывает снимок пропорционально; старый вид переносит в готовый приём", async () => {
    const e = await createEntry(db, ME, { foodId: tvorogId, grams: 200, meal: "snack", eatenAt: at("2026-09-30", "15:00") }, ctx());
    const upd = await updateEntry(db, ME, e.id, { grams: 50, meal: "lunch" }, ctx());
    expect(upd.grams).toBe(50);
    expect(upd.meal).toBe("lunch");
    expect(upd.mealName).toBe("Обед");
    expect(upd.nutrients.kcal).toBeCloseTo(60.5);
    expect(upd.nutrients.vitD).toBeNull();
    // «Перекус» опустел и исчез
    expect(await names("2026-09-30")).toEqual(["Обед"]);
    // тот же вид (старый лист правки присылает его всегда) — не перенос
    const same = await updateEntry(db, ME, e.id, { grams: 60, meal: "lunch" }, ctx());
    expect(same.mealId).toBe(upd.mealId);
  });

  it("чужие записи и личные продукты недоступны", async () => {
    const [mine] = (await day(D)).entries;
    await expect(updateEntry(db, OTHER, mine.id, { grams: 1 }, ctx())).rejects.toBeInstanceOf(NotFoundError);
    expect(await deleteEntry(db, OTHER, mine.id)).toBe(false);
    await expect(
      createEntry(db, ME, { foodId: privateFoodId, grams: 100, meal: "lunch", eatenAt: new Date() }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await day(D, OTHER)).entries).toHaveLength(0);
  });

  it("удаление и недавние продукты; опустевший приём удаляется", async () => {
    const recent = await recentFoods(db, ME);
    expect(recent[0]).toMatchObject({ foodId: tvorogId, lastGrams: 60 });
    const [first] = (await day(D)).entries;
    expect(await deleteEntry(db, ME, first.id)).toBe(true);
    expect((await day(D)).entries).toHaveLength(1);
    expect(await names(D)).toEqual(["Ужин"]);
  });
});

describe("приёмы пищи дня", () => {
  const add = (date: string, body: Record<string, unknown> = {}, now = new Date("2026-10-15T09:00:00Z")) =>
    createEntry(db, ME, { foodId: tvorogId, grams: 100, date, ...body }, ctx(now));

  it("приём по названию: один на день, названия без учёта регистра", async () => {
    const D = "2026-09-01";
    const a = await add(D, { mealName: "  второй   завтрак " });
    const b = await add(D, { mealName: "Второй ЗАВТРАК" });
    expect(a.mealName).toBe("Второй завтрак");
    expect(b.mealId).toBe(a.mealId);
    const d = await day(D);
    expect(d.meals).toHaveLength(1);
    expect(d.meals[0].entries.map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it("новый приём встаёт по списку пользователя, а не в конец", async () => {
    const D = "2026-09-02";
    await add(D, { mealName: "Ужин" });
    await add(D, { mealName: "Завтрак" });
    await add(D, { mealName: "Обед" });
    await add(D, { mealName: "Кофе с коллегами" });
    await add(D, { mealName: "Перекус" });
    expect(await names(D)).toEqual(["Завтрак", "Обед", "Перекус", "Ужин", "Кофе с коллегами"]);
  });

  it("newMeal — отдельный приём с тем же названием", async () => {
    const D = "2026-09-03";
    const s1 = await add(D, { mealName: "Перекус" });
    const s2 = await add(D, { mealName: "Перекус", newMeal: true });
    const s3 = await add(D, { mealName: "Перекус" });
    expect(s2.mealId).not.toBe(s1.mealId);
    expect(s3.mealId).toBe(s2.mealId); // без newMeal — последний с этим названием
    expect(await names(D)).toEqual(["Перекус", "Перекус"]);
  });

  it("mealId: свой приём; чужой — 404, другого дня — 400; день берётся у приёма", async () => {
    const D = "2026-09-04";
    const first = await add(D, { mealName: "Обед" });
    const joined = await createEntry(db, ME, { foodId: tvorogId, grams: 50, mealId: first.mealId }, ctx(new Date("2026-10-15T09:00:00Z")));
    expect(joined.mealId).toBe(first.mealId);
    expect(joined.eatenAt).toEqual(first.eatenAt); // прошлый день — время приёма
    await expect(add("2026-09-05", { mealId: first.mealId })).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      createEntry(db, OTHER, { foodId: tvorogId, grams: 50, mealId: first.mealId }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(add(D, { mealId: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("mealId удалённого приёма с названием (офлайн-очередь) — в приём с этим названием, запись не теряется", async () => {
    const D = "2026-09-16";
    const gone = await add(D, { mealName: "Полдник" });
    await deleteEntry(db, ME, gone.id); // приём опустел и удалён
    const lunch = await add(D, { mealName: "Обед" });
    const late = await add(D, { mealId: gone.mealId, mealName: "Обед" });
    expect(late.mealId).toBe(lunch.mealId);
    const revived = await add(D, { mealId: gone.mealId, mealName: "Полдник" });
    expect(revived.mealName).toBe("Полдник");
    expect(revived.mealId).not.toBe(gone.mealId);
    // Чужой приём по id не достаётся — запись встаёт в свой приём с этим названием.
    const theirs = await createEntry(db, OTHER, { foodId: tvorogId, grams: 50, date: D, mealName: "Ужин" }, ctx());
    const mine = await add(D, { mealId: theirs.mealId, mealName: "Ужин" });
    expect(mine.mealId).not.toBe(theirs.mealId);
  });

  it("время: явное, с телефона в тот же день, сегодня «сейчас», прошлый день — время приёма или типичное", async () => {
    const D = "2026-09-06";
    const breakfast = await add(D, { mealName: "завтрак" });
    expect(breakfast.eatenAt).toEqual(at(D, "08:30"));
    const custom = await add(D, { mealName: "Полдник" });
    expect(custom.eatenAt).toEqual(at(D, "13:30")); // своё название — время вида в полдень (обед)
    expect(custom.meal).toBe("lunch");
    const timed = await add(D, { mealName: "Ужин", time: "21:15" });
    expect(timed.eatenAt).toEqual(at(D, "21:15"));
    expect(timed.meal).toBe("dinner");
    // время с телефона — только в тот же местный день
    const phone = await add(D, { mealName: "Ужин", eatenAt: at(D, "21:40") });
    expect(phone.eatenAt).toEqual(at(D, "21:40"));
    const wrongDay = await add(D, { mealName: "Ужин", eatenAt: at("2026-09-07", "08:00") });
    expect(wrongDay.eatenAt).toEqual(at(D, "21:15")); // → время начатого ужина
    // сегодня — «сейчас»
    const now = at("2026-10-15", "12:05");
    const today = await add("2026-10-15", { mealName: "Обед" }, now);
    expect(today.eatenAt).toEqual(now);
    // без date: день — по времени с телефона
    const queued = await createEntry(db, ME, { foodId: tvorogId, grams: 10, meal: "snack", eatenAt: at("2026-09-08", "17:00") }, ctx());
    expect((await day("2026-09-08")).meals.map((m) => [m.name, m.time])).toEqual([["Перекус", "17:00"]]);
    expect(queued.eatenAt).toEqual(at("2026-09-08", "17:00"));
  });

  it("без приёма: по часу в пустой день, недавний приём, затем следующий по списку", async () => {
    const D = "2026-09-09";
    const lunch = await add(D, {}, at(D, "13:00"));
    expect(lunch.mealName).toBe("Обед");
    const more = await add(D, {}, at(D, "13:40"));
    expect(more.mealId).toBe(lunch.mealId);
    const later = await add(D, {}, at(D, "17:30"));
    expect(later.mealName).toBe("Перекус");
    // виджет присылает только время с телефона: день и «сейчас» — по нему
    const widget = await createEntry(db, ME, { foodId: tvorogId, grams: 10, eatenAt: at(D, "17:45") }, ctx(at(D, "18:00")));
    expect(widget.mealId).toBe(later.mealId);
    expect(await names(D)).toEqual(["Обед", "Перекус"]);
  });

  it("свой список приёмов из профиля задаёт порядок", async () => {
    await saveProfile(db, OTHER, { sex: "female", birthYear: 1990, heightCm: 165, activity: "light", timezone: TZ });
    await db
      .update(profiles)
      .set({ mealPlan: ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин"] })
      .where(eq(profiles.ownerId, OTHER));
    const D = "2026-09-10";
    const put = (mealName: string) => createEntry(db, OTHER, { foodId: tvorogId, grams: 10, date: D, mealName }, ctx());
    await put("Ужин");
    await put("Полдник");
    await put("Завтрак");
    await put("второй завтрак");
    expect(await names(D, OTHER)).toEqual(["Завтрак", "Второй завтрак", "Полдник", "Ужин"]);
    const next = await createEntry(db, OTHER, { foodId: tvorogId, grams: 10, date: D }, ctx(at("2026-10-15", "12:00")));
    expect(next.mealName).toBe("Ужин"); // список пройден, прошлый день — последний приём
  });

  it("день: приёмы по порядку, время первой записи, итоги", async () => {
    const D = "2026-09-11";
    const b1 = await add(D, { mealName: "Завтрак", time: "08:10" });
    await add(D, { mealName: "Обед", time: "13:00" });
    const b2 = await add(D, { mealName: "Завтрак", time: "07:50" });
    const d = await day(D);
    expect(d.meals.map((m) => [m.name, m.time, m.entries.length])).toEqual([
      ["Завтрак", "07:50", 2],
      ["Обед", "13:00", 1],
    ]);
    expect(d.meals[0].entries.map((e) => e.id)).toEqual([b2.id, b1.id]);
    expect(d.meals[0].lastAt).toEqual(at(D, "08:10"));
    expect(d.meals[0].totals.kcal).toBeCloseTo(242);
    expect(d.totals.kcal).toBeCloseTo(363);
    expect(d.entries.map((e) => e.mealName)).toEqual(["Завтрак", "Завтрак", "Обед"]);
  });
});

describe("перенос записи в другой приём", () => {
  const D = "2026-09-12";
  const add = (mealName: string, time: string) =>
    createEntry(db, ME, { foodId: tvorogId, grams: 100, date: D, mealName, time }, ctx());

  it("в приём с записями — на его время; опустевший приём удаляется; вид пересчитывается", async () => {
    const lunch = await add("Обед", "13:00");
    const snack = await add("Перекус", "16:30");
    const moved = await updateEntry(db, ME, snack.id, { mealId: lunch.mealId }, ctx());
    expect(moved).toMatchObject({ mealId: lunch.mealId, mealName: "Обед", meal: "lunch" });
    expect(moved.eatenAt).toEqual(at(D, "13:00"));
    expect(await names(D)).toEqual(["Обед"]);
  });

  it("по названию: в приём дня с ним или новый (время прежнее)", async () => {
    const [lunch] = (await day(D)).meals;
    const e = lunch.entries[1];
    const alone = await updateEntry(db, ME, e.id, { mealName: "Ужин" }, ctx());
    expect(alone).toMatchObject({ mealName: "Ужин", meal: "dinner" });
    expect(alone.eatenAt).toEqual(at(D, "13:00"));
    expect(await names(D)).toEqual(["Обед", "Ужин"]);
    // то же название — не перенос
    expect((await updateEntry(db, ME, e.id, { mealName: "ужин" }, ctx())).mealId).toBe(alone.mealId);
    // newMeal с тем же названием для единственной записи приёма — тот же приём
    const again = await updateEntry(db, ME, e.id, { mealName: "Ужин", newMeal: true }, ctx());
    expect(again.mealId).toBe(alone.mealId);
    expect(await names(D)).toEqual(["Обед", "Ужин"]);
    // обратно в обед по названию
    const back = await updateEntry(db, ME, e.id, { mealName: "Обед" }, ctx());
    expect(back.mealId).toBe(lunch.id);
    expect(await names(D)).toEqual(["Обед"]);
  });

  it("«новый» приём с тем же названием для единственной записи — тот же приём, порядок дня не меняется", async () => {
    const D2 = "2026-09-14";
    const put = (mealName: string) => createEntry(db, ME, { foodId: tvorogId, grams: 10, date: D2, mealName }, ctx());
    await put("Завтрак");
    const snack = await put("Перекус");
    await put("Ужин");
    const same = await updateEntry(db, ME, snack.id, { mealName: "Перекус", newMeal: true }, ctx());
    expect(same.mealId).toBe(snack.mealId);
    expect(await names(D2)).toEqual(["Завтрак", "Перекус", "Ужин"]);
    // в приёме есть другие записи — отдельный новый «Перекус»
    const other = await put("Перекус");
    expect(other.mealId).toBe(snack.mealId);
    const split = await updateEntry(db, ME, other.id, { mealName: "Перекус", newMeal: true }, ctx());
    expect(split.mealId).not.toBe(snack.mealId);
    expect(await names(D2)).toEqual(["Завтрак", "Перекус", "Ужин", "Перекус"]);
  });

  it("time с названием: время нового приёма (или своего, где запись одна); в приёме с записями — его время", async () => {
    const D3 = "2026-09-15";
    const put = (mealName: string, time: string) =>
      createEntry(db, ME, { foodId: tvorogId, grams: 10, date: D3, mealName, time }, ctx());
    const lunch = await put("Обед", "13:00");
    const tea = await put("Обед", "13:10");
    // в новый приём — на выбранное время, вид — по новому названию
    const moved = await updateEntry(db, ME, tea.id, { mealName: "Полдник", newMeal: true, time: "16:05" }, ctx());
    expect(moved.mealId).not.toBe(lunch.mealId);
    expect(moved.eatenAt).toEqual(at(D3, "16:05"));
    expect(moved.meal).toBe("snack");
    // «новый» с тем же названием, запись в приёме одна — время приёма меняется
    const retimed = await updateEntry(db, ME, tea.id, { mealName: "Полдник", newMeal: true, time: "17:20" }, ctx());
    expect(retimed.mealId).toBe(moved.mealId);
    expect(retimed.eatenAt).toEqual(at(D3, "17:20"));
    // в приём с записями — его время, time не действует
    const back = await updateEntry(db, ME, tea.id, { mealName: "Обед", time: "18:00" }, ctx());
    expect(back.mealId).toBe(lunch.mealId);
    expect(back.eatenAt).toEqual(at(D3, "13:00"));
    // без названия time не меняет время
    const grams = await updateEntry(db, ME, lunch.id, { grams: 20, time: "09:00" }, ctx());
    expect(grams.eatenAt).toEqual(at(D3, "13:00"));
  });

  it("в приём другого дня — 400, в чужой — 404", async () => {
    const [lunch] = (await day(D)).meals;
    const other = await createEntry(db, ME, { foodId: tvorogId, grams: 1, date: "2026-09-13", mealName: "Обед" }, ctx());
    await expect(updateEntry(db, ME, lunch.entries[0].id, { mealId: other.mealId }, ctx())).rejects.toBeInstanceOf(
      BadRequestError,
    );
    const theirs = await createEntry(db, OTHER, { foodId: tvorogId, grams: 1, date: D, mealName: "Обед" }, ctx());
    await expect(updateEntry(db, ME, lunch.entries[0].id, { mealId: theirs.mealId }, ctx())).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(updateEntry(db, OTHER, theirs.id, { mealId: lunch.id }, ctx())).rejects.toBeInstanceOf(NotFoundError);
    // ничего не сдвинулось
    expect((await day(D)).meals[0].entries).toHaveLength(2);
    expect((await day(D, OTHER)).meals.map((m) => m.name)).toEqual(["Обед"]);
  });
});

describe("калории по дням", () => {
  it("сумма ккал по местным дням from…to включительно; только свои; дней без записей нет", async () => {
    const [{ id: teaId }] = await db
      .insert(foods)
      .values({ ownerId: ME, nameRu: "Чай", source: "manual", nutrientsPer100g: { kcal: null, protein: 0 } })
      .returning({ id: foods.id });
    const put = (date: string, grams: number, foodId = tvorogId, owner = ME) =>
      createEntry(db, owner, { foodId, grams, date, mealName: "Обед" }, ctx());
    await put("2026-08-09", 100); // до диапазона
    await put("2026-08-10", 100);
    await put("2026-08-10", 200);
    await put("2026-08-10", 250, teaId); // ккал неизвестны — за 0
    await put("2026-08-12", 50);
    await put("2026-08-13", 300, teaId); // день только с неизвестными ккал — 0, но он есть
    await put("2026-08-16", 100); // последний день диапазона
    await put("2026-08-17", 100); // после диапазона
    await put("2026-08-11", 100, tvorogId, OTHER); // чужая запись
    await db.insert(dayMeals).values({ ownerId: ME, date: "2026-08-14", name: "Ужин", position: 1 }); // пустой приём — дня нет

    const kcal = async (owner: string, from: string, to: string) =>
      (await kcalByDay(db, owner, from, to)).map((d) => [d.date, Math.round(d.kcal * 10) / 10]);
    expect(await kcal(ME, "2026-08-10", "2026-08-16")).toEqual([
      ["2026-08-10", 363],
      ["2026-08-12", 60.5],
      ["2026-08-13", 0],
      ["2026-08-16", 121],
    ]);
    expect(await kcal(ME, "2026-08-12", "2026-08-12")).toEqual([["2026-08-12", 60.5]]);
    expect(await kcal(OTHER, "2026-08-10", "2026-08-16")).toEqual([["2026-08-11", 121]]);
    expect(await kcal(ME, "2026-08-01", "2026-08-08")).toEqual([]);
  });
});

describe("миграция 0005: приёмы дня из вида старых записей", () => {
  const folder = path.resolve(__dirname, "../../drizzle");
  /** PGlite с миграциями до tag (не включая) — БД «как до обновления». */
  async function dbBefore(tag: string) {
    const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
    const idx = journal.entries.findIndex((j: { tag: string }) => j.tag.startsWith(tag));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "calo-mig-"));
    fs.mkdirSync(path.join(dir, "meta"));
    fs.writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, idx) }));
    for (const j of journal.entries.slice(0, idx)) fs.copyFileSync(path.join(folder, `${j.tag}.sql`), path.join(dir, `${j.tag}.sql`));
    const client = await PGlite.create({ extensions: { pg_trgm } });
    const old = drizzle(client);
    await migrate(old, { migrationsFolder: dir });
    return {
      client,
      upgrade: () => migrate(old, { migrationsFolder: folder }),
      close: async () => {
        await client.close();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  it("один приём на (владелец, местный день, вид): название — по виду, порядок — по первой записи", async () => {
    const { client, upgrade, close } = await dbBefore("0005_");
    try {
      await client.exec(`
        insert into "user" (id, name, email, email_verified, created_at, updated_at) values
          ('u', 'U', 'u@calo.test', false, now(), now()),
          ('v', 'V', 'v@calo.test', false, now(), now()),
          ('w', 'W', 'w@calo.test', false, now(), now()),
          ('x', 'X', 'x@calo.test', false, now(), now());
        insert into profiles (owner_id, sex, birth_year, height_cm, activity, timezone) values
          ('v', 'male', 1990, 180, 'light', 'Asia/Yerevan'),
          ('w', 'male', 1990, 180, 'light', 'Mars/Olympus'),
          ('x', 'female', 1990, 165, 'light', 'asia/tokyo');
        insert into entries (owner_id, eaten_at, meal, input_method, title, grams, nutrients) values
          ('u', '2026-09-29T05:00:00Z', 'breakfast', 'product', 'Каша', 200, '{}'),
          ('u', '2026-09-29T05:10:00Z', 'breakfast', 'product', 'Кофе', 200, '{}'),
          ('u', '2026-09-29T08:00:00Z', 'snack', 'product', 'Яблоко', 150, '{}'),
          ('u', '2026-09-29T10:00:00Z', 'lunch', 'product', 'Суп', 300, '{}'),
          ('u', '2026-09-29T13:30:00Z', 'snack', 'product', 'Орехи', 30, '{}'),
          ('u', '2026-09-29T16:00:00Z', 'dinner', 'product', 'Рыба', 180, '{}'),
          ('u', '2026-09-29T16:05:00Z', 'dinner', 'product', 'Салат', 100, '{}'),
          ('u', '2026-09-28T20:30:00Z', 'dinner', 'product', 'Гречка', 180, '{}'),
          ('v', '2026-09-28T20:30:00Z', 'dinner', 'product', 'Хачапури', 250, '{}'),
          ('v', '2026-09-29T09:00:00Z', 'lunch', 'product', 'Долма', 250, '{}'),
          ('w', '2026-09-28T20:30:00Z', 'dinner', 'product', 'Пельмени', 250, '{}'),
          ('x', '2026-09-28T20:30:00Z', 'snack', 'product', 'Моти', 50, '{}'),
          ('x', '2026-09-28T20:30:00Z', 'breakfast', 'product', 'Мисо', 200, '{}');
      `);
      await upgrade();

      const { rows: meals } = await client.query<{ owner_id: string; date: string; name: string; position: number }>(
        `select owner_id, to_char(date, 'YYYY-MM-DD') as date, name, position from day_meals order by owner_id, date, position`,
      );
      expect(meals).toEqual([
        { owner_id: "u", date: "2026-09-28", name: "Ужин", position: 1 }, // 23:30 МСК — ещё 28-е (профиля нет — Москва)
        { owner_id: "u", date: "2026-09-29", name: "Завтрак", position: 1 },
        { owner_id: "u", date: "2026-09-29", name: "Перекус", position: 2 }, // два перекуса дня — один приём
        { owner_id: "u", date: "2026-09-29", name: "Обед", position: 3 },
        { owner_id: "u", date: "2026-09-29", name: "Ужин", position: 4 },
        { owner_id: "v", date: "2026-09-29", name: "Ужин", position: 1 }, // 00:30 в Ереване — уже 29-е, и раньше обеда
        { owner_id: "v", date: "2026-09-29", name: "Обед", position: 2 },
        { owner_id: "w", date: "2026-09-28", name: "Ужин", position: 1 }, // неизвестный пояс — Москва
        { owner_id: "x", date: "2026-09-29", name: "Завтрак", position: 1 }, // пояс без учёта регистра; одно время — по названию
        { owner_id: "x", date: "2026-09-29", name: "Перекус", position: 2 },
      ]);

      const { rows } = await client.query<{ title: string; name: string; date: string }>(
        `select e.title, m.name, to_char(m.date, 'YYYY-MM-DD') as date
         from entries e join day_meals m on m.id = e.meal_id and m.owner_id = e.owner_id order by e.title`,
      );
      expect(rows).toHaveLength(13);
      expect(Object.fromEntries(rows.map((r) => [r.title, `${r.date} ${r.name}`]))).toEqual({
        Каша: "2026-09-29 Завтрак",
        Кофе: "2026-09-29 Завтрак",
        Яблоко: "2026-09-29 Перекус",
        Орехи: "2026-09-29 Перекус",
        Суп: "2026-09-29 Обед",
        Рыба: "2026-09-29 Ужин",
        Салат: "2026-09-29 Ужин",
        Гречка: "2026-09-28 Ужин",
        Хачапури: "2026-09-29 Ужин",
        Долма: "2026-09-29 Обед",
        Пельмени: "2026-09-28 Ужин",
        Моти: "2026-09-29 Перекус",
        Мисо: "2026-09-29 Завтрак",
      });

      const { rows: cols } = await client.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
         where table_name = 'entries' and column_name like 'meal%' order by 1`,
      );
      expect(cols).toEqual([
        { column_name: "meal", is_nullable: "NO" },
        { column_name: "meal_id", is_nullable: "NO" },
      ]);
      const { rows: prof } = await client.query<{ meal_plan: string[]; show_meal_times: boolean }>(
        `select meal_plan, show_meal_times from profiles order by owner_id`,
      );
      expect(prof).toEqual(
        Array(3).fill({ meal_plan: ["Завтрак", "Обед", "Перекус", "Ужин"], show_meal_times: false }),
      );
      await expect(
        client.query(`insert into entries (owner_id, eaten_at, meal, input_method, title, grams, nutrients) values ('u', now(), 'snack', 'product', 'x', 1, '{}')`),
      ).rejects.toThrow(/meal_id/);
      // приём удаляется — его записи следом
      await client.query(`delete from day_meals where owner_id = 'u' and date = '2026-09-29' and name = 'Перекус'`);
      expect((await client.query(`select 1 from entries where owner_id = 'u'`)).rows).toHaveLength(6);
    } finally {
      await close();
    }
  });

  it("свежая база: схема приёмов на месте", async () => {
    const [m] = await db
      .insert(dayMeals)
      .values({ ownerId: ME, date: "2026-01-01", name: "Тест", position: 1 })
      .returning();
    expect(m).toMatchObject({ date: "2026-01-01", name: "Тест", position: 1 });
    await db.delete(dayMeals).where(eq(dayMeals.id, m.id));
  });
});
