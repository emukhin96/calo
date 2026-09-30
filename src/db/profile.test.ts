import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normsFromState } from "@/lib/norms";
import { createTestDb } from "@/test/db";
import { dbBefore } from "@/test/migrations";
import type { DB } from ".";
import { NotFoundError } from "./errors";
import {
  addWeight,
  getMealSettings,
  getUserState,
  saveMealSettings,
  saveProfile,
  setGoal,
  setOverride,
  weightHistory,
} from "./profile";
import { goals, profiles, user } from "./schema";

let db: DB;
let close: () => Promise<void>;
const ME = "me";
const NOW = new Date("2026-09-29T12:00:00Z");
const DEFAULT = ["Завтрак", "Обед", "Ужин", "Перекус"];
const visible = (plan: string[]) => plan.map((name) => ({ name, hidden: false }));

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: ME, name: "Me", email: "me@calo.test" });
});
afterAll(() => close());

describe("профиль и нормы", () => {
  it("до онбординга норм нет; приёмы пищи — по умолчанию, сохранить их нельзя", async () => {
    const state = await getUserState(db, ME);
    expect(normsFromState(state)).toBeNull();
    expect(state).toMatchObject({ mealPlan: DEFAULT, mealItems: visible(DEFAULT), showMealTimes: false });
    expect(await getMealSettings(db, ME)).toEqual({ plan: DEFAULT, items: visible(DEFAULT), showTimes: false });
    await expect(saveMealSettings(db, ME, { showTimes: true })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("онбординг → нормы", async () => {
    await saveProfile(db, ME, { sex: "male", birthYear: 1996, heightCm: 180, activity: "moderate", timezone: "Asia/Yerevan" });
    await setGoal(db, ME, { kind: "maintain", rateKgPerWeek: null, targetWeightKg: null });
    await addWeight(db, ME, 80, new Date("2026-09-01T08:00:00Z"));
    const state = await getUserState(db, ME);
    expect(state.profile).toMatchObject({ sex: "male", timezone: "Asia/Yerevan" });
    expect(state.profile?.onboardedAt).toBeInstanceOf(Date);
    expect(normsFromState(state, NOW)?.kcal).toBe(2760); // возраст 30, как в norms.test
  });

  it("смена цели — новая строка истории, повтор той же цели — нет", async () => {
    await setGoal(db, ME, { kind: "lose", rateKgPerWeek: 0.5, targetWeightKg: 75 });
    await setGoal(db, ME, { kind: "lose", rateKgPerWeek: 0.5, targetWeightKg: 75 });
    expect(await db.select().from(goals)).toHaveLength(2);
    const state = await getUserState(db, ME);
    expect(state.goal).toEqual({ kind: "lose", rateKgPerWeek: 0.5, targetWeightKg: 75 });
    expect(normsFromState(state, NOW)?.kcal).toBe(2210);
  });

  it("текущий вес — последнее взвешивание, история по порядку", async () => {
    await addWeight(db, ME, 79.2, new Date("2026-09-20T08:00:00Z"));
    const state = await getUserState(db, ME);
    expect(state.weight?.kg).toBe(79.2);
    expect((await weightHistory(db, ME)).map((w) => w.kg)).toEqual([80, 79.2]);
  });

  it("вес из Apple Health: повторный импорт того же замера не дублирует", async () => {
    const at = new Date("2026-09-21T07:00:00Z");
    await addWeight(db, ME, 79.0, at, { source: "apple_health", externalId: "HK-1" });
    await addWeight(db, ME, 79.0, at, { source: "apple_health", externalId: "HK-1" });
    expect((await weightHistory(db, ME)).filter((w) => w.kg === 79.0)).toHaveLength(1);
  });

  it("ручная норма и её отмена", async () => {
    await setOverride(db, ME, "kcal", 2000);
    await setOverride(db, ME, "protein", 150);
    let norms = normsFromState(await getUserState(db, ME), NOW)!;
    expect([norms.kcal, norms.nutrients.protein?.value]).toEqual([2000, 150]);
    await setOverride(db, ME, "kcal", null);
    norms = normsFromState(await getUserState(db, ME), NOW)!;
    expect(norms.kcal).not.toBe(2000);
    expect(norms.nutrients.protein?.value).toBe(150);
  });
});

describe("настройки приёмов пищи", () => {
  it("новый профиль — стандартный набор (завтрак, обед, ужин, перекус), время скрыто", async () => {
    expect(await getMealSettings(db, ME)).toEqual({ plan: DEFAULT, items: visible(DEFAULT), showTimes: false });
  });

  it("свой список (старые клиенты — plan) и показ времени сохраняются по отдельности; профиль их не сбрасывает", async () => {
    const plan = ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Перекус", "Ужин", "Перекус"];
    const saved = { plan, items: visible(plan) };
    expect(await saveMealSettings(db, ME, { plan })).toEqual({ ...saved, showTimes: false });
    expect(await saveMealSettings(db, ME, { showTimes: true })).toEqual({ ...saved, showTimes: true });
    await saveProfile(db, ME, { sex: "male", birthYear: 1996, heightCm: 181, activity: "moderate", timezone: "Asia/Yerevan" });
    const state = await getUserState(db, ME);
    expect(state.mealPlan).toEqual(plan);
    expect(state.mealItems).toEqual(visible(plan));
    expect(state.showMealTimes).toBe(true);
    expect(await saveMealSettings(db, ME, {})).toEqual({ ...saved, showTimes: true });
  });

  it("скрытые приёмы: весь список — items, предлагаемые — plan (без скрытых)", async () => {
    const items = [
      { name: "Завтрак", hidden: false },
      { name: "Второй завтрак", hidden: true },
      { name: "Обед", hidden: false },
      { name: "Ужин", hidden: false },
      { name: "Перекус", hidden: true },
    ];
    const plan = ["Завтрак", "Обед", "Ужин"];
    expect(await saveMealSettings(db, ME, { items })).toEqual({ plan, items, showTimes: true });
    expect(await getMealSettings(db, ME)).toEqual({ plan, items, showTimes: true });
    const state = await getUserState(db, ME);
    expect([state.mealPlan, state.mealItems]).toEqual([plan, items]);
    // в хранении — все названия по порядку и скрытые отдельно
    const [row] = await db
      .select({ plan: profiles.mealPlan, hidden: profiles.mealPlanHidden })
      .from(profiles)
      .where(eq(profiles.ownerId, ME));
    expect(row).toEqual({ plan: ["Завтрак", "Второй завтрак", "Обед", "Ужин", "Перекус"], hidden: ["Второй завтрак", "Перекус"] });
    // показ времени скрытые не трогает; старый клиент со списком — все видны
    expect((await saveMealSettings(db, ME, { showTimes: false })).items).toEqual(items);
    expect(await saveMealSettings(db, ME, { plan })).toEqual({ plan, items: visible(plan), showTimes: false });
  });
});

describe("миграция 0006: скрытые приёмы и новый порядок по умолчанию", () => {
  it("список по умолчанию — в новом порядке, свой — как был; скрытых нет", async () => {
    const { client, upgrade, close } = await dbBefore("0006_");
    try {
      await client.exec(`
        insert into "user" (id, name, email, email_verified, created_at, updated_at) values
          ('d', 'D', 'd@calo.test', false, now(), now()),
          ('c', 'C', 'c@calo.test', false, now(), now()),
          ('s', 'S', 's@calo.test', false, now(), now()),
          ('n', 'N', 'n@calo.test', false, now(), now());
        insert into profiles (owner_id, sex, birth_year, height_cm, activity, timezone) values
          ('d', 'male', 1990, 180, 'light', 'Europe/Moscow'),
          ('s', 'male', 1990, 180, 'light', 'Europe/Moscow');
        insert into profiles (owner_id, sex, birth_year, height_cm, activity, timezone, meal_plan, show_meal_times) values
          ('c', 'female', 1990, 165, 'light', 'Europe/Moscow', '{Завтрак,Второй завтрак,Обед,Перекус,Ужин}', true);
        update profiles set show_meal_times = true where owner_id = 's';
      `);
      await upgrade();
      await client.exec(`insert into profiles (owner_id, sex, birth_year, height_cm, activity, timezone) values ('n', 'male', 1990, 180, 'light', 'Europe/Moscow')`);
      const { rows } = await client.query<{ owner_id: string; meal_plan: string[]; meal_plan_hidden: string[]; show_meal_times: boolean }>(
        `select owner_id, meal_plan, meal_plan_hidden, show_meal_times from profiles order by owner_id`,
      );
      expect(rows).toEqual([
        { owner_id: "c", meal_plan: ["Завтрак", "Второй завтрак", "Обед", "Перекус", "Ужин"], meal_plan_hidden: [], show_meal_times: true },
        { owner_id: "d", meal_plan: DEFAULT, meal_plan_hidden: [], show_meal_times: false },
        { owner_id: "n", meal_plan: DEFAULT, meal_plan_hidden: [], show_meal_times: false }, // новый профиль
        { owner_id: "s", meal_plan: DEFAULT, meal_plan_hidden: [], show_meal_times: true }, // список не менял — время тут ни при чём
      ]);
    } finally {
      await close();
    }
  });
});
