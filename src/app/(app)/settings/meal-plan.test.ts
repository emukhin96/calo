import { describe, expect, it } from "vitest";
import { DEFAULT_MEAL_PLAN, type MealPlanItem, normalizeMealPlanItems } from "@/domain/meals";
import { addMealItem, canRemove, insertIndex, MEAL_SUGGESTIONS, mealSuggestions, renameItem, toggleHidden } from "./meal-plan";

const insert = (plan: string[], name: string) => {
  const at = insertIndex(plan, name);
  return [...plan.slice(0, at), name, ...plan.slice(at)];
};

/** Список из строки: «Обед*» — скрытый. */
const items = (...names: string[]): MealPlanItem[] =>
  names.map((n) => ({ name: n.replace("*", ""), hidden: n.endsWith("*") }));
const show = (list: MealPlanItem[] | null) => list?.map((i) => `${i.name}${i.hidden ? "*" : ""}`) ?? null;
const make = (name: string): MealPlanItem => ({ name, hidden: false });

describe("insertIndex", () => {
  it("знакомые приёмы встают на своё место в дне, «Перекус» остаётся в конце", () => {
    expect(insert(DEFAULT_MEAL_PLAN, "Второй завтрак")).toEqual(["Завтрак", "Второй завтрак", "Обед", "Ужин", "Перекус"]);
    expect(insert(DEFAULT_MEAL_PLAN, "Полдник")).toEqual(["Завтрак", "Обед", "Полдник", "Ужин", "Перекус"]);
    expect(insert(DEFAULT_MEAL_PLAN, "Поздний ужин")).toEqual(["Завтрак", "Обед", "Ужин", "Поздний ужин", "Перекус"]);
  });

  it("список пользователя из примера собирается без перетаскивания", () => {
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
    expect(insertIndex(DEFAULT_MEAL_PLAN, "Ужин")).toBe(3);
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
  it("только того, чего нет в списке", () => {
    expect(mealSuggestions(DEFAULT_MEAL_PLAN)).toEqual(["Второй завтрак", "Полдник", "Поздний ужин"]);
    expect(mealSuggestions([])).toEqual(MEAL_SUGGESTIONS);
    expect(mealSuggestions(["завтрак", "  ОБЕД "])).toEqual(["Второй завтрак", "Полдник", "Ужин", "Поздний ужин", "Перекус"]);
    expect(mealSuggestions(MEAL_SUGGESTIONS)).toEqual([]);
  });
});

describe("addMealItem", () => {
  it("новый — на своё место по порядку дня", () => {
    expect(show(addMealItem(items("Завтрак", "Обед", "Ужин", "Перекус"), "Полдник", make))).toEqual([
      "Завтрак",
      "Обед",
      "Полдник",
      "Ужин",
      "Перекус",
    ]);
    expect(show(addMealItem(items("Завтрак"), "Кофе", make))).toEqual(["Завтрак", "Кофе"]);
  });

  it("скрытый с тем же названием — снова предлагается, второй не заводится", () => {
    expect(show(addMealItem(items("Завтрак", "Перекус*", "Ужин"), " перекус ", make))).toEqual(["Завтрак", "Перекус", "Ужин"]);
  });

  it("видимый с тем же названием — ещё одно место в списке", () => {
    expect(show(addMealItem(items("Завтрак", "Обед"), "Завтрак", make))).toEqual(["Завтрак", "Завтрак", "Обед"]);
  });
});

describe("toggleHidden / canRemove", () => {
  it("скрывает и показывает название целиком", () => {
    expect(show(toggleHidden(items("Завтрак", "Полдник", "Обед", "полдник"), 1))).toEqual(["Завтрак", "Полдник*", "Обед", "полдник*"]);
    expect(show(toggleHidden(items("Завтрак", "Полдник*", "Обед", "Полдник*"), 3))).toEqual(["Завтрак", "Полдник", "Обед", "Полдник"]);
  });

  it("последний предлагаемый не скрыть", () => {
    expect(toggleHidden(items("Завтрак", "Обед*"), 0)).toBeNull();
    expect(toggleHidden(items("Обед", "Обед"), 0)).toBeNull();
    expect(toggleHidden(items("Обед"), 5)).toBeNull();
  });

  it("убрать можно, пока остаётся хоть один предлагаемый", () => {
    expect(canRemove(items("Завтрак", "Обед"), 0)).toBe(true);
    expect(canRemove(items("Завтрак", "Обед*"), 0)).toBe(false);
    expect(canRemove(items("Завтрак", "Обед*"), 1)).toBe(true);
    expect(canRemove(items("Завтрак"), 0)).toBe(false);
  });
});

describe("renameItem", () => {
  it("новое название — признак «скрыт» у строки прежний", () => {
    expect(show(renameItem(items("Завтрак", "Обед", "Ужин"), 1, "Ланч"))).toEqual(["Завтрак", "Ланч", "Ужин"]);
    expect(show(renameItem(items("Завтрак", "Обед*", "Ужин"), 1, "Ланч"))).toEqual(["Завтрак", "Ланч*", "Ужин"]);
  });

  it("в скрытое название — оно снова предлагается целиком, а не скрывается молча", () => {
    expect(show(renameItem(items("Завтрак", "Обед", "Перекус*"), 1, "Перекус"))).toEqual(["Завтрак", "Перекус", "Перекус"]);
    // Единственный предлагаемый в скрытое: список не остаётся без предлагаемых.
    expect(show(renameItem(items("Обед", "Перекус*"), 0, "Перекус"))).toEqual(["Перекус", "Перекус"]);
  });

  it("скрытый — в предлагаемое название: тоже предлагается; прежние строки его названия не трогаются", () => {
    expect(show(renameItem(items("Обед", "Полдник*", "Полдник*"), 1, "Обед"))).toEqual(["Обед", "Обед", "Полдник*"]);
  });

  it("оба скрыты — остаётся скрытым", () => {
    expect(show(renameItem(items("Завтрак", "Обед*", "Полдник*"), 1, "Полдник"))).toEqual(["Завтрак", "Полдник*", "Полдник*"]);
  });

  it("сервер сохранит список как есть — то, что видно в Профиле", () => {
    const cases: [MealPlanItem[], number, string][] = [
      [items("Завтрак", "Обед", "Перекус*"), 1, "Перекус"],
      [items("Обед", "Перекус*"), 0, "Перекус"],
      [items("Обед", "Полдник*", "Полдник*"), 1, "Обед"],
      [items("Завтрак", "Обед*", "Полдник*"), 1, "Полдник"],
    ];
    for (const [list, i, name] of cases) {
      const next = renameItem(list, i, name);
      expect(normalizeMealPlanItems(next)).toEqual(next);
    }
  });
});
