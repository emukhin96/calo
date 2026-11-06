import { describe, expect, it } from "vitest";
import { coverage, isLabelConsistent, per100gOf, scale, sum } from "./nutrients";

describe("scale", () => {
  it("пересчитывает на 100 г в порцию", () => {
    expect(scale({ kcal: 350, protein: 12 }, 50)).toEqual({ kcal: 175, protein: 6 });
  });

  it("сохраняет «нет данных» как null", () => {
    expect(scale({ kcal: 100, vitD: null }, 200)).toEqual({ kcal: 200, vitD: null });
  });
});

describe("per100gOf", () => {
  it("снимок порции — обратно на 100 г", () => {
    expect(per100gOf({ kcal: 242, protein: 32 }, 200)).toEqual({ kcal: 121, protein: 16 });
    expect(per100gOf({ kcal: 0 }, 50)).toEqual({ kcal: 0 });
  });

  it("обратное к scale: пересчёт на новые граммы", () => {
    const portion = scale({ kcal: 121, fat: 5, vitC: 0.5 }, 180);
    const again = scale(per100gOf(portion, 180), 50);
    expect(again.kcal).toBeCloseTo(60.5);
    expect(again.fat).toBeCloseTo(2.5);
    expect(again.vitC).toBeCloseTo(0.25);
  });

  it("«нет данных» остаётся null, отсутствующие ключи не появляются", () => {
    expect(per100gOf({ kcal: 100, vitD: null }, 200)).toEqual({ kcal: 50, vitD: null });
    expect(per100gOf({}, 100)).toEqual({});
  });

  it("граммы <= 0: пересчитать не из чего — известные значения тоже null", () => {
    expect(per100gOf({ kcal: 100, protein: 5, vitD: null }, 0)).toEqual({ kcal: null, protein: null, vitD: null });
    expect(per100gOf({ kcal: 100 }, -10)).toEqual({ kcal: null });
  });
});

describe("sum", () => {
  it("складывает известные значения", () => {
    expect(sum([{ kcal: 100, protein: 5 }, { kcal: 50, protein: 1 }])).toEqual({ kcal: 150, protein: 6 });
  });

  it("не выдаёт частичную сумму за полную", () => {
    expect(sum([{ kcal: 100, vitD: 2 }, { kcal: 50 }])).toEqual({ kcal: 150, vitD: null });
  });

  it("пустой список — пустой вектор", () => {
    expect(sum([])).toEqual({});
  });
});

describe("coverage", () => {
  it("доля слагаемых с известным значением", () => {
    expect(coverage([{ vitD: 1 }, { vitD: null }, {}, { vitD: 0 }], "vitD")).toBe(0.5);
  });
});

describe("isLabelConsistent", () => {
  it("нормальная этикетка сходится", () => {
    expect(isLabelConsistent({ kcal: 356, protein: 14.5, fat: 1.6, carbs: 69.5, fiber: 3 })).toBe(true);
    expect(isLabelConsistent({ kcal: 121, protein: 16, fat: 5, carbs: 3 })).toBe(true);
    expect(isLabelConsistent({ kcal: 0, protein: 0, fat: 0, carbs: 0 })).toBe(true);
  });

  it("опечатка в белке или углеводах — не сходится", () => {
    expect(isLabelConsistent({ kcal: 356, protein: 0.1, fat: 0.9, carbs: 62 })).toBe(false);
    expect(isLabelConsistent({ kcal: 375, protein: 16.1, fat: 3.6, carbs: 21.4 })).toBe(false);
  });

  it("без БЖУ — не сходится", () => {
    expect(isLabelConsistent({ kcal: 100 })).toBe(false);
  });

  it("Канада и США: углеводы вместе с клетчаткой — тоже сходится", () => {
    // Brown lentils, Канада: углеводы 29 г, из них клетчатка 15 г
    expect(isLabelConsistent({ kcal: 170, protein: 13, fat: 1, carbs: 29, fiber: 15 })).toBe(true);
    // Fibre 1: 83 г углеводов, 13 г клетчатки, 333 ккал
    expect(isLabelConsistent({ kcal: 333, protein: 7.4, fat: 2.8, carbs: 83.3, fiber: 13 })).toBe(true);
    // клетчатки больше углеводов — опечатка, а не другой счёт
    expect(isLabelConsistent({ kcal: 139, protein: 11.1, fat: 8.3, carbs: 0, fiber: 38.9 })).toBe(false);
  });

  it("спирт: коньяк и пиво", () => {
    expect(isLabelConsistent({ kcal: 231, protein: 0, fat: 0, carbs: 0 }, 33)).toBe(true);
    expect(isLabelConsistent({ kcal: 231, protein: 0, fat: 0, carbs: 0 })).toBe(false);
    expect(isLabelConsistent({ kcal: 43, protein: 0.5, fat: 0, carbs: 3.6 }, 3.9)).toBe(true);
  });
});
