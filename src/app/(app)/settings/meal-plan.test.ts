import { describe, expect, it } from "vitest";
import { DEFAULT_MEAL_PLAN } from "@/domain/meals";
import { insertIndex, MEAL_SUGGESTIONS, mealSuggestions, moveItem } from "./meal-plan";

const insert = (plan: string[], name: string) => {
  const at = insertIndex(plan, name);
  return [...plan.slice(0, at), name, ...plan.slice(at)];
};

describe("insertIndex", () => {
  it("знакомые приёмы встают на своё место в дне", () => {
    expect(insert(DEFAULT_MEAL_PLAN, "Второй завтрак")).toEqual(["Завтрак", "Второй завтрак", "Обед", "Перекус", "Ужин"]);
    expect(insert(DEFAULT_MEAL_PLAN, "Полдник")).toEqual(["Завтрак", "Обед", "Полдник", "Перекус", "Ужин"]);
    expect(insert(DEFAULT_MEAL_PLAN, "Поздний ужин")).toEqual(["Завтрак", "Обед", "Перекус", "Ужин", "Поздний ужин"]);
  });

  it("список пользователя из примера собирается без стрелок", () => {
    let plan = ["Завтрак", "Обед", "Ужин"];
    plan = insert(plan, "Полдник");
    plan = insert(plan, "Второй завтрак");
    expect(plan).toEqual(["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин"]);
  });

  it("регистр и пробелы не важны", () => {
    expect(insertIndex(["Завтрак", "Обед"], "  второй   ЗАВТРАК ")).toBe(1);
    expect(insertIndex(["завтрак", "обед"], "Полдник")).toBe(2);
  });

  it("раньше всех знакомых — перед первым из них, приёмы не из порядка дня не мешают", () => {
    expect(insertIndex(["Обед", "Ужин"], "Завтрак")).toBe(0);
    expect(insertIndex(["Кофе", "Обед", "Ужин"], "Завтрак")).toBe(1);
    expect(insertIndex(["Кофе", "Перекус", "Обед", "Кофе"], "Полдник")).toBe(3);
  });

  it("повтор знакомого — сразу после такого же", () => {
    expect(insertIndex(DEFAULT_MEAL_PLAN, "Завтрак")).toBe(1);
    expect(insertIndex(DEFAULT_MEAL_PLAN, "Ужин")).toBe(4);
  });

  it("свой порядок пользователя уважается: после последнего более раннего", () => {
    // Ужин передвинут наверх — Полдник встаёт после Обеда, а не перед Ужином.
    expect(insertIndex(["Ужин", "Завтрак", "Обед"], "Полдник")).toBe(3);
  });

  it("своё название и «Перекус» — в конец", () => {
    expect(insertIndex(DEFAULT_MEAL_PLAN, "Перекус")).toBe(4);
    expect(insertIndex(DEFAULT_MEAL_PLAN, "Кофе с печеньем")).toBe(4);
    expect(insertIndex([], "Обед")).toBe(0);
    expect(insertIndex(["Кофе"], "Обед")).toBe(1);
  });
});

describe("mealSuggestions", () => {
  it("только того, чего нет в списке; «Перекус» — всегда", () => {
    expect(mealSuggestions(DEFAULT_MEAL_PLAN)).toEqual(["Второй завтрак", "Полдник", "Перекус", "Поздний ужин"]);
    expect(mealSuggestions([])).toEqual(MEAL_SUGGESTIONS);
    expect(mealSuggestions(["завтрак", "  ОБЕД "])).toEqual(["Второй завтрак", "Полдник", "Перекус", "Ужин", "Поздний ужин"]);
    expect(mealSuggestions(MEAL_SUGGESTIONS)).toEqual(["Перекус"]);
  });
});

describe("moveItem", () => {
  it("меняет местами с соседом", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("на краю — без изменений и новый массив", () => {
    const list = ["a", "b"];
    const up = moveItem(list, 0, -1);
    expect(up).toEqual(["a", "b"]);
    expect(up).not.toBe(list);
    expect(moveItem(list, 1, 1)).toEqual(["a", "b"]);
    expect(moveItem(list, 5, -1)).toEqual(["a", "b"]);
  });
});
