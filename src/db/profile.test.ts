import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normsFromState } from "@/lib/norms";
import { createTestDb } from "@/test/db";
import type { DB } from ".";
import { addWeight, getUserState, saveProfile, setGoal, setOverride, weightHistory } from "./profile";
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
  it("до онбординга норм нет", async () => {
    expect(normsFromState(await getUserState(db, ME))).toBeNull();
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
