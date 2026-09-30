import { describe, expect, it } from "vitest";
import {
  addTabOf,
  choiceMealName,
  initialTextOf,
  preferredKey,
  preferredMealOf,
  preferredMealTitle,
  rowMealBody,
  TEXT_MAX,
} from "./add-flow";

const ID = "3f0c9a2e-5b1d-4c7a-9e2f-1a2b3c4d5e6f";
const ID2 = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";

describe("preferredMealOf", () => {
  it("id приёма дня — { mealId } (в нижнем регистре)", () => {
    expect(preferredMealOf(ID)).toEqual({ mealId: ID });
    expect(preferredMealOf(` ${ID.toUpperCase()} `)).toEqual({ mealId: ID });
  });

  it("название приёма — нормализованное", () => {
    expect(preferredMealOf("  второй   завтрак ")).toEqual({ name: "Второй завтрак" });
    expect(preferredMealOf("перекус")).toEqual({ name: "Перекус" });
  });

  it("старые ссылки ?meal=lunch — готовое название вида", () => {
    expect(preferredMealOf("lunch")).toEqual({ name: "Обед" });
    expect(preferredMealOf("snack")).toEqual({ name: "Перекус" });
  });

  it("пусто, мусор, несколько значений — null; похожее на id, но не id — название", () => {
    expect(preferredMealOf(undefined)).toBeNull();
    expect(preferredMealOf("   ")).toBeNull();
    expect(preferredMealOf(["Обед", "Ужин"])).toBeNull();
    expect(preferredMealOf("3f0c9a2e-5b1d")).toEqual({ name: "3f0c9a2e-5b1d" });
  });

  it("ключ для вкладок — id или название", () => {
    expect(preferredKey(null)).toBe("");
    expect(preferredKey({ mealId: ID })).toBe(ID);
    expect(preferredKey({ name: "Обед" })).toBe("Обед");
  });
});

describe("preferredMealTitle", () => {
  const meals = [
    { id: ID, name: "Перекус", time: "11:00" },
    { id: "b", name: "Обед", time: "13:05" },
    { id: ID2, name: "Перекус", time: "16:40" },
  ];

  it("приём дня по id — подпись как в дневнике, без времени", () => {
    expect(preferredMealTitle(meals, { mealId: ID2 }, false)).toEqual({ label: "Перекус · 2", time: null });
    expect(preferredMealTitle(meals, { mealId: "b" }, false)).toEqual({ label: "Обед", time: null });
  });

  it("с показом времени — время начала приёма", () => {
    expect(preferredMealTitle(meals, { mealId: ID }, true)).toEqual({ label: "Перекус", time: "11:00" });
  });

  it("по названию — последний приём дня с ним (как выберет лист порции)", () => {
    expect(preferredMealTitle(meals, { name: "перекус" }, false)).toEqual({ label: "Перекус · 2", time: null });
  });

  it("названия в дне нет — как есть; id не нашёлся — null", () => {
    expect(preferredMealTitle(meals, { name: "Ужин" }, true)).toEqual({ label: "Ужин", time: null });
    expect(preferredMealTitle(meals, { mealId: "gone" }, false)).toBeNull();
    expect(preferredMealTitle([], null, false)).toBeNull();
  });
});

describe("initialTextOf / addTabOf", () => {
  it("текст из дневника — без краевых пробелов и не длиннее лимита разбора", () => {
    expect(initialTextOf("  творог 180, кофе ")).toBe("творог 180, кофе");
    expect(initialTextOf("   ")).toBeNull();
    expect(initialTextOf(undefined)).toBeNull();
    expect(initialTextOf("а".repeat(TEXT_MAX + 50))).toHaveLength(TEXT_MAX);
  });

  it("с текстом — всегда «Текст»; иначе ?tab=, иначе «Продукт»", () => {
    expect(addTabOf("recipes", "кефир 250")).toBe("text");
    expect(addTabOf("recipes", null)).toBe("recipes");
    expect(addTabOf("text", null)).toBe("text");
    expect(addTabOf("photo", null)).toBe("food");
    expect(addTabOf(undefined, null)).toBe("food");
  });
});

describe("choiceMealName", () => {
  const meals = [
    { id: ID, name: "Завтрак" },
    { id: ID2, name: "Второй завтрак" },
  ];

  it("приём дня — его название; новый — нормализованное", () => {
    expect(choiceMealName({ kind: "existing", mealId: ID2 }, meals)).toBe("Второй завтрак");
    expect(choiceMealName({ kind: "new", name: " ужин ", time: null }, meals)).toBe("Ужин");
  });

  it("не нашёлся или пустое название — null", () => {
    expect(choiceMealName({ kind: "existing", mealId: "gone" }, meals)).toBeNull();
    expect(choiceMealName({ kind: "new", name: "  ", time: null }, meals)).toBeNull();
  });
});

describe("rowMealBody", () => {
  it("начатый приём — все позиции по id", () => {
    const c = { kind: "existing", mealId: ID } as const;
    expect(rowMealBody(c, undefined)).toEqual({ mealId: ID });
    expect(rowMealBody(c, ID2)).toEqual({ mealId: ID });
  });

  it("новый: первая позиция создаёт приём, остальные — в него по id", () => {
    const c = { kind: "new", name: "перекус", time: null } as const;
    expect(rowMealBody(c, undefined)).toEqual({ mealName: "Перекус", newMeal: true });
    expect(rowMealBody(c, ID2)).toEqual({ mealId: ID2, mealName: "Перекус" });
  });

  it("новый с выставленным временем — время у всех позиций одно", () => {
    const c = { kind: "new", name: "Полдник", time: "16:05" } as const;
    expect(rowMealBody(c, undefined)).toEqual({ mealName: "Полдник", newMeal: true, time: "16:05" });
    expect(rowMealBody(c, ID2)).toEqual({ mealId: ID2, mealName: "Полдник", time: "16:05" });
  });

  it("первая ушла в очередь — остальные по названию, без newMeal", () => {
    expect(rowMealBody({ kind: "new", name: "Ужин", time: null }, null)).toEqual({ mealName: "Ужин" });
    expect(rowMealBody({ kind: "new", name: "Ужин", time: "19:00" }, null)).toEqual({ mealName: "Ужин", time: "19:00" });
  });
});
