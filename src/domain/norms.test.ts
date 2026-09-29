import { describe, expect, it } from "vitest";
import { applyOverrides, bmrMifflin, computeNorms, type NormInput, proteinReferenceWeight } from "./norms";

const man: NormInput = { sex: "male", age: 30, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain" };
const woman: NormInput = { sex: "female", age: 30, heightCm: 165, weightKg: 60, activity: "light", goal: "maintain" };

describe("bmrMifflin", () => {
  it("формула для мужчин и женщин", () => {
    expect(bmrMifflin(man)).toBe(1780); // 800 + 1125 − 150 + 5
    expect(bmrMifflin(woman)).toBeCloseTo(1320.25); // 600 + 1031.25 − 150 − 161
  });
});

describe("computeNorms — калории", () => {
  it("удержание: BMR × активность", () => {
    const n = computeNorms(man);
    expect(n.meta.tdee).toBe(2759); // 1780 × 1,55
    expect(n.kcal).toBe(2760);
    expect(n.kcalRange).toEqual([2480, 3040]);
  });

  it("снижение 0,5 кг/нед — дефицит 550 ккал", () => {
    expect(computeNorms({ ...man, goal: "lose", rateKgPerWeek: 0.5 }).kcal).toBe(2210);
  });

  it("быстрое снижение упирается в безопасный минимум", () => {
    const n = computeNorms({ ...woman, activity: "sedentary", goal: "lose", rateKgPerWeek: 0.75 });
    // TDEE 1584 − 825 = 759 < max(BMR×1,1 = 1452, 1200)
    expect(n.kcal).toBe(1450);
    expect(n.meta.floorApplied).toBe(true);
  });

  it("набор ограничен +15 % к TDEE", () => {
    const n = computeNorms({ ...woman, activity: "sedentary", goal: "gain", rateKgPerWeek: 0.75 });
    expect(n.kcal).toBe(1820); // min(1584 + 825, 1584 × 1,15 = 1822)
  });
});

describe("computeNorms — БЖУ", () => {
  it("белок г/кг по цели, жиры 30 %, углеводы остаток", () => {
    const n = computeNorms(man);
    expect(n.nutrients.protein).toEqual({ value: 112, kind: "min" }); // 1,4 × 80
    expect(n.nutrients.fat?.value).toBe(92); // 30 % от 2760 / 9
    expect(n.nutrients.carbs?.value).toBe(371); // (2760 − 448 − 828) / 4
  });

  it("при ИМТ > 30 белок считается от веса при ИМТ 27", () => {
    expect(proteinReferenceWeight(170, 110)).toBeCloseTo(78.03);
    expect(computeNorms({ ...man, heightCm: 170, weightKg: 110, goal: "lose" }).nutrients.protein?.value).toBe(140);
  });
});

describe("computeNorms — витамины и минералы (МР 2.3.1.0253-21)", () => {
  it("отличия мужчин и женщин", () => {
    const m = computeNorms(man).nutrients;
    const f = computeNorms(woman).nutrients;
    expect([m.iron?.value, f.iron?.value]).toEqual([10, 18]);
    expect([m.vitA?.value, f.vitA?.value]).toEqual([900, 800]);
    expect([m.selenium?.value, f.selenium?.value]).toEqual([70, 55]);
    expect(m.vitC).toEqual({ value: 100, kind: "min" });
  });

  it("старше 65: больше витамина D и кальция", () => {
    const n = computeNorms({ ...man, age: 70 }).nutrients;
    expect(n.vitD?.value).toBe(20);
    expect(n.calcium?.value).toBe(1200);
  });

  it("натрий — верхний предел", () => {
    expect(computeNorms(man).nutrients.sodium).toEqual({ value: 2000, kind: "limit" });
  });
});

describe("applyOverrides", () => {
  it("ручная норма заменяет расчётную и двигает коридор калорий", () => {
    const n = applyOverrides(computeNorms(man), { kcal: 2400, protein: 150, vitD: 0 });
    expect(n.kcal).toBe(2400);
    expect(n.kcalRange).toEqual([2160, 2640]);
    expect(n.nutrients.protein).toEqual({ value: 150, kind: "min" });
    expect(n.nutrients.vitD?.value).toBe(15); // 0 — не правка
  });
});
