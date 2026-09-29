import { describe, expect, it } from "vitest";
import { computeRecipe } from "./recipe";

// Паста из задачи: 50 г сливок 20 %, 50 г пармезана, 100 г сухой пасты.
const cream = { per100g: { kcal: 205, protein: 2.5, fat: 20, carbs: 3.8 }, grams: 50 };
const parmesan = { per100g: { kcal: 392, protein: 35.75, fat: 25, carbs: 3.22, vitD: 0.5 }, grams: 50 };
const pasta = { per100g: { kcal: 356, protein: 14.5, fat: 1.6, carbs: 69.5 }, grams: 100 };

describe("computeRecipe", () => {
  it("без веса готового блюда — по сумме ингредиентов", () => {
    const r = computeRecipe([cream, parmesan, pasta]);
    expect(r.rawWeightG).toBe(200);
    expect(r.totalWeightG).toBe(200);
    expect(r.total.kcal).toBeCloseTo(654.5); // 102,5 + 196 + 356
    expect(r.total.protein).toBeCloseTo(33.625);
    expect(r.per100g.kcal).toBeCloseTo(327.25);
  });

  it("вес готового блюда: паста впитала воду — калорийность на 100 г ниже", () => {
    const r = computeRecipe([cream, parmesan, pasta], { totalWeightG: 350 });
    expect(r.total.kcal).toBeCloseTo(654.5); // всё блюдо — те же калории
    expect(r.per100g.kcal).toBeCloseTo(187); // 654,5 / 3,5
  });

  it("порции делят готовый вес", () => {
    expect(computeRecipe([cream, parmesan, pasta], { totalWeightG: 350, portions: 2 }).portionG).toBe(175);
    expect(computeRecipe([pasta], { portions: 0 }).portionG).toBeNull();
  });

  it("нутриент, известный не у всех ингредиентов, в итоге неизвестен", () => {
    const r = computeRecipe([cream, parmesan, pasta]);
    expect(r.per100g.vitD).toBeNull();
  });

  it("пустой рецепт", () => {
    const r = computeRecipe([]);
    expect([r.rawWeightG, r.totalWeightG, r.per100g]).toEqual([0, 0, {}]);
  });
});
