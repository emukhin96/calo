import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normsFromState } from "@/lib/norms";
import { createTestDb } from "@/test/db";
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
import { goals, user } from "./schema";

let db: DB;
let close: () => Promise<void>;
const ME = "me";
const NOW = new Date("2026-09-29T12:00:00Z");

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: ME, name: "Me", email: "me@calo.test" });
});
afterAll(() => close());

describe("профиль и нормы", () => {
  it("до онбординга норм нет; приёмы пищи — по умолчанию, сохранить их нельзя", async () => {
    const state = await getUserState(db, ME);
    expect(normsFromState(state)).toBeNull();
    expect(state).toMatchObject({ mealPlan: ["Завтрак", "Обед", "Перекус", "Ужин"], showMealTimes: false });
    expect(await getMealSettings(db, ME)).toEqual({ plan: ["Завтрак", "Обед", "Перекус", "Ужин"], showTimes: false });
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
  it("новый профиль — список по умолчанию, время скрыто", async () => {
    expect(await getMealSettings(db, ME)).toEqual({ plan: ["Завтрак", "Обед", "Перекус", "Ужин"], showTimes: false });
  });

  it("свой список и показ времени сохраняются по отдельности; профиль их не сбрасывает", async () => {
    const plan = ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Перекус", "Ужин", "Перекус"];
    expect(await saveMealSettings(db, ME, { plan })).toEqual({ plan, showTimes: false });
    expect(await saveMealSettings(db, ME, { showTimes: true })).toEqual({ plan, showTimes: true });
    await saveProfile(db, ME, { sex: "male", birthYear: 1996, heightCm: 181, activity: "moderate", timezone: "Asia/Yerevan" });
    const state = await getUserState(db, ME);
    expect(state.mealPlan).toEqual(plan);
    expect(state.showMealTimes).toBe(true);
    expect(await saveMealSettings(db, ME, {})).toEqual({ plan, showTimes: true });
  });
});
