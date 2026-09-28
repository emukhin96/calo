import { describe, expect, it } from "vitest";
import { coverage, scale, sum } from "./nutrients";

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
