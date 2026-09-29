import { describe, expect, it } from "vitest";
import { coverage, isLabelConsistent, scale, sum } from "./nutrients";

describe("scale", () => {
  it("пересчитывает на 100 г в порцию", () => {
    expect(scale({ kcal: 350, protein: 12 }, 50)).toEqual({ kcal: 175, protein: 6 });
  });

  it("сохраняет «нет данных» как null", () => {
    expect(scale({ kcal: 100, vitD: null }, 200)).toEqual({ kcal: 200, vitD: null });
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
});
