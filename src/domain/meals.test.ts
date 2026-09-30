import { describe, expect, it } from "vitest";
import { zonedTime } from "./day";
import {
  clampMealName,
  DEFAULT_MEAL_PLAN,
  defaultMealName,
  defaultMealTarget,
  formatTime,
  hiddenNames,
  isSnack,
  MEAL_PLAN_MAX,
  mealKindOf,
  mealLabels,
  mealToJoin,
  normalizeMealName,
  normalizeMealPlan,
  normalizeMealPlanItems,
  parseTime,
  placeNewMeal,
  planItems,
  planNames,
  PRESET_TIME,
  presetOf,
  visiblePlan,
} from "./meals";

const TZ = "Europe/Moscow";
/** Местное время 29 сентября в Москве. */
const at = (hhmm: string, date = "2026-09-29") => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTime(date, h, m, TZ);
};

describe("normalizeMealName", () => {
  it("пробелы, заглавная буква", () => {
    expect(normalizeMealName("  второй   завтрак ")).toBe("Второй завтрак");
    expect(normalizeMealName("полдник\nс\tкофе")).toBe("Полдник с кофе");
  });

  it("пустое и управляющие символы → null", () => {
    expect(normalizeMealName("")).toBeNull();
    expect(normalizeMealName("   ")).toBeNull();
    expect(normalizeMealName(null)).toBeNull();
    expect(normalizeMealName(undefined)).toBeNull();
    expect(normalizeMealName("\u0000\u0007")).toBeNull();
    expect(normalizeMealName("​‎")).toBeNull();
    expect(normalizeMealName("🍎")).toBe("🍎");
    expect(normalizeMealName("пере\u0000кус")).toBe("Пере кус");
  });

  it("не длиннее 40 знаков, эмодзи не режется пополам", () => {
    expect(normalizeMealName("а".repeat(50))).toBe("А" + "а".repeat(39));
    const name = normalizeMealName("x".repeat(39) + "🍎🍎");
    expect(Array.from(name!)).toHaveLength(40);
    expect(name!.endsWith("🍎")).toBe(true);
    // обрезка по пробелу не оставляет хвостового пробела
    expect(normalizeMealName("a".repeat(39) + " bcd")).toBe("A" + "a".repeat(38));
  });

  it("готовые названия — в каноническом написании", () => {
    expect(normalizeMealName("ЗАВТРАК")).toBe("Завтрак");
    expect(normalizeMealName(" перекус ")).toBe("Перекус");
    expect(presetOf("обед")).toBe("Обед");
    expect(presetOf("Второй завтрак")).toBeNull();
  });

  it("isSnack: «Перекус» без учёта регистра и пробелов", () => {
    expect(isSnack("Перекус")).toBe(true);
    expect(isSnack("  ПЕРЕКУС ")).toBe(true);
    expect(isSnack("Перекус 2")).toBe(false);
    expect(isSnack("Полдник")).toBe(false);
    expect(isSnack("")).toBe(false);
  });
});

describe("clampMealName: поле названия на клиенте", () => {
  it("40 кодовых точек, как normalizeMealName, а не 40 единиц UTF-16", () => {
    const apples = "🍎".repeat(45);
    expect(apples.length).toBe(90);
    expect(clampMealName(apples)).toBe("🍎".repeat(40)); // maxLength={40} оставил бы 20
    expect(clampMealName("а".repeat(41))).toBe("а".repeat(40));
    // короче лимита — как есть (пробелы и регистр поправит normalizeMealName)
    expect(clampMealName("  перекус ")).toBe("  перекус ");
    expect(clampMealName("")).toBe("");
  });

  it("суррогатная пара не режется пополам; составной эмодзи — по кодовым точкам", () => {
    const cut = clampMealName("x".repeat(39) + "🍎🍎");
    expect(cut).toBe("x".repeat(39) + "🍎");
    // 👨‍👩‍👧 — пять кодовых точек (три эмодзи и два ZWJ): на границе остаётся начало,
    // но без половинок суррогатных пар
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const tail = clampMealName("x".repeat(37) + family);
    expect(Array.from(tail)).toHaveLength(40);
    expect(tail).toBe("x".repeat(37) + "\u{1F468}\u200D\u{1F469}");
    expect(tail.isWellFormed()).toBe(true);
    // результат normalizeMealName не меняет
    expect(normalizeMealName(clampMealName("x".repeat(37) + family))).toBe(normalizeMealName("x".repeat(37) + family));
  });
});

describe("вид приёма и название по умолчанию", () => {
  it.each([
    ["Обед", 8, "lunch"],
    ["перекус", 9, "snack"],
    ["Ужин", 23, "dinner"],
    ["Второй завтрак", 10, "breakfast"],
    ["Ночной дожор", 2, "snack"],
    ["Кофе с коллегами", 13, "lunch"],
  ] as const)("%s в %i ч → %s", (name, hour, kind) => {
    expect(mealKindOf(name, hour)).toBe(kind);
  });

  it("defaultMealName по часу", () => {
    expect(defaultMealName(9)).toBe("Завтрак");
    expect(defaultMealName(13)).toBe("Обед");
    expect(defaultMealName(17)).toBe("Перекус");
    expect(defaultMealName(20)).toBe("Ужин");
  });

  it("типичное время готовых приёмов", () => {
    expect(PRESET_TIME).toEqual({ Завтрак: [8, 30], Обед: [13, 30], Перекус: [16, 30], Ужин: [19, 30] });
  });

  it("parseTime / formatTime", () => {
    expect(parseTime("08:30")).toEqual({ hour: 8, minute: 30 });
    expect(parseTime("8:05")).toEqual({ hour: 8, minute: 5 });
    expect(parseTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("12:60")).toBeNull();
    expect(parseTime("1230")).toBeNull();
    expect(parseTime(undefined)).toBeNull();
    expect(formatTime(at("07:05"), TZ)).toBe("07:05");
  });
});


describe("normalizeMealPlan", () => {
  it("названия нормализуются, пустые выбрасываются, повторы остаются", () => {
    expect(normalizeMealPlan(["  завтрак", "второй   завтрак", "", "Перекус", "ПЕРЕКУС", " ", "ужин"])).toEqual([
      "Завтрак",
      "Второй завтрак",
      "Перекус",
      "Перекус",
      "Ужин",
    ]);
    expect(normalizeMealPlan(DEFAULT_MEAL_PLAN)).toEqual(["Завтрак", "Обед", "Ужин", "Перекус"]);
  });

  it("список по умолчанию — стандартный набор: завтрак, обед, ужин, перекус", () => {
    expect(DEFAULT_MEAL_PLAN).toEqual(["Завтрак", "Обед", "Ужин", "Перекус"]);
  });

  it("от 1 до 12 приёмов; не список строк — null", () => {
    expect(normalizeMealPlan([])).toBeNull();
    expect(normalizeMealPlan(["", "  "])).toBeNull();
    expect(normalizeMealPlan("Завтрак")).toBeNull();
    expect(normalizeMealPlan(null)).toBeNull();
    expect(normalizeMealPlan(["Завтрак", 1])).toBeNull();
    expect(normalizeMealPlan(Array(MEAL_PLAN_MAX).fill("Перекус"))).toHaveLength(12);
    expect(normalizeMealPlan(Array(MEAL_PLAN_MAX + 1).fill("Перекус"))).toBeNull();
    // пустые не считаются
    expect(normalizeMealPlan([...Array(MEAL_PLAN_MAX).fill("Перекус"), ""])).toHaveLength(12);
  });
});

describe("свой список со скрытыми приёмами", () => {
  it("normalizeMealPlanItems: названия нормализуются, пустые выбрасываются, повторы остаются", () => {
    expect(
      normalizeMealPlanItems([
        { name: "  завтрак", hidden: false },
        { name: "второй   завтрак", hidden: true },
        { name: " ", hidden: true },
        { name: "Обед" },
        { name: "ПЕРЕКУС", hidden: false },
      ]),
    ).toEqual([
      { name: "Завтрак", hidden: false },
      { name: "Второй завтрак", hidden: true },
      { name: "Обед", hidden: false },
      { name: "Перекус", hidden: false },
    ]);
  });

  it("скрыто название целиком: повтор скрыт, если скрыто хоть одно вхождение", () => {
    expect(
      normalizeMealPlanItems([
        { name: "Кофе", hidden: false },
        { name: "Обед", hidden: false },
        { name: "кофе", hidden: true },
      ]),
    ).toEqual([
      { name: "Кофе", hidden: true },
      { name: "Обед", hidden: false },
      { name: "Кофе", hidden: true },
    ]);
  });

  it("1–12 приёмов и хотя бы один не скрыт; неверная форма — null", () => {
    expect(normalizeMealPlanItems([])).toBeNull();
    expect(normalizeMealPlanItems([{ name: "  " }])).toBeNull();
    expect(normalizeMealPlanItems([{ name: "Обед", hidden: true }])).toBeNull();
    expect(normalizeMealPlanItems([{ name: "Обед", hidden: true }, { name: "обед" }])).toBeNull();
    expect(normalizeMealPlanItems(["Обед"])).toBeNull();
    expect(normalizeMealPlanItems([{ name: 1 }])).toBeNull();
    expect(normalizeMealPlanItems([{ name: "Обед", hidden: "yes" }])).toBeNull();
    expect(normalizeMealPlanItems([null])).toBeNull();
    expect(normalizeMealPlanItems({ name: "Обед" })).toBeNull();
    expect(normalizeMealPlanItems(Array(MEAL_PLAN_MAX).fill({ name: "Полдник" }))).toHaveLength(12);
    expect(normalizeMealPlanItems(Array(MEAL_PLAN_MAX + 1).fill({ name: "Полдник" }))).toBeNull();
  });

  it("planItems из хранения, visiblePlan и hiddenNames", () => {
    const items = planItems(["Завтрак", "Второй завтрак", "Обед", "Ужин", "Перекус"], ["второй ЗАВТРАК", "Ужин", "Нет такого"]);
    expect(items).toEqual([
      { name: "Завтрак", hidden: false },
      { name: "Второй завтрак", hidden: true },
      { name: "Обед", hidden: false },
      { name: "Ужин", hidden: true },
      { name: "Перекус", hidden: false },
    ]);
    expect(visiblePlan(items)).toEqual(["Завтрак", "Обед", "Перекус"]);
    expect(hiddenNames(items)).toEqual(["Второй завтрак", "Ужин"]);
    expect(hiddenNames([{ name: "Кофе", hidden: true }, { name: "Кофе", hidden: true }])).toEqual(["Кофе"]);
    expect(planItems(DEFAULT_MEAL_PLAN, [])).toEqual(DEFAULT_MEAL_PLAN.map((name) => ({ name, hidden: false })));
  });

  it("скрыто всё (правка базы руками) — показываются все", () => {
    expect(visiblePlan(planItems(["Завтрак", "Обед"], ["Завтрак", "Обед"]))).toEqual(["Завтрак", "Обед"]);
  });
});

describe("planNames", () => {
  it("свой список без повторов, в его порядке", () => {
    expect(planNames(["Завтрак", "Перекус", "Обед", "Перекус", "Ужин"])).toEqual(["Завтрак", "Перекус", "Обед", "Ужин"]);
  });

  it("повтор с другим регистром и пробелами — тот же приём; пустые выбрасываются", () => {
    expect(planNames(["Второй завтрак", "второй  ЗАВТРАК", " ", "Обед"])).toEqual(["Второй завтрак", "Обед"]);
    expect(planNames([])).toEqual([]);
  });
});

describe("placeNewMeal: новый приём встаёт по списку пользователя", () => {
  const PLAN = DEFAULT_MEAL_PLAN;
  const m = (name: string, position: number) => ({ name, position });

  it("пустой день — 1", () => {
    expect(placeNewMeal([], "Обед", PLAN)).toBe(1);
    expect(placeNewMeal([], "Кофе", PLAN)).toBe(1);
  });

  it("между соседями по списку, в начало, в конец", () => {
    expect(placeNewMeal([m("Завтрак", 1), m("Ужин", 2)], "Обед", PLAN)).toBe(1.5);
    expect(placeNewMeal([m("Ужин", 1)], "Завтрак", PLAN)).toBe(0);
    expect(placeNewMeal([m("Завтрак", 1)], "ужин", PLAN)).toBe(2);
    expect(placeNewMeal([m("Обед", 3), m("Завтрак", 1), m("Ужин", 7)], "Полдник", ["Завтрак", "Обед", "Полдник", "Ужин"])).toBe(5);
  });

  it("«Перекус» — всегда в конец дня, где бы он ни стоял в списке", () => {
    expect(placeNewMeal([m("Обед", 3), m("Завтрак", 1), m("Ужин", 7)], "Перекус", PLAN)).toBe(8);
    expect(placeNewMeal([m("Завтрак", 1), m("Обед", 2)], " перекус", ["Перекус", "Завтрак", "Обед", "Ужин"])).toBe(3);
    expect(placeNewMeal([m("Завтрак", 1), m("Обед", 2), m("Ужин", 3)], "Перекус", ["Завтрак", "Перекус", "Обед", "Ужин"])).toBe(4);
    expect(placeNewMeal([], "Перекус", PLAN)).toBe(1);
  });

  it("перекусы в дне остаются на месте и не сдвигают другие приёмы", () => {
    // перекус после завтрака, затем ужин — после перекуса, а не перед ним
    expect(placeNewMeal([m("Завтрак", 1), m("Перекус", 2)], "Ужин", PLAN)).toBe(3);
    // обед — перед ужином, перекус утром не мешает
    expect(placeNewMeal([m("Завтрак", 1), m("Перекус", 2), m("Ужин", 3)], "Обед", PLAN)).toBe(2.5);
    // «Перекус» первым в списке — всё равно не место в дне
    expect(placeNewMeal([m("Перекус", 1), m("Обед", 2)], "Завтрак", ["Перекус", "Завтрак", "Обед", "Ужин"])).toBe(1.5);
  });

  it("день в любом порядке — сравнение по позициям", () => {
    expect(placeNewMeal([m("Ужин", 5), m("Завтрак", 1)], "Обед", PLAN)).toBe(3);
  });

  it("приём, которого нет в списке, — в конец дня", () => {
    expect(placeNewMeal([m("Завтрак", 1), m("Обед", 2)], "Кофе с коллегами", PLAN)).toBe(3);
    // второй «Обед» при одном в списке — тоже в конец
    expect(placeNewMeal([m("Обед", 1), m("Ужин", 2)], "Обед", PLAN)).toBe(3);
  });

  it("приёмы не из списка остаются на месте и не участвуют в сравнении", () => {
    expect(placeNewMeal([m("Кофе", 1), m("Ужин", 2)], "Завтрак", PLAN)).toBe(1.5);
    expect(placeNewMeal([m("Завтрак", 1), m("Кофе", 2)], "Обед", PLAN)).toBe(3);
    expect(placeNewMeal([m("Кофе", 1), m("Кофе", 2), m("Обед", 3)], "Завтрак", PLAN)).toBe(2.5);
  });

  it("повторы в списке: k-й приём с названием — k-е место в списке", () => {
    const plan = ["Завтрак", "Полдник", "Обед", "Полдник", "Ужин"];
    // первый «Полдник» — между завтраком и обедом
    expect(placeNewMeal([m("Завтрак", 1), m("Обед", 2), m("Ужин", 3)], "Полдник", plan)).toBe(1.5);
    // второй — между обедом и ужином
    expect(placeNewMeal([m("Завтрак", 1), m("Полдник", 2), m("Обед", 3), m("Ужин", 4)], "полдник", plan)).toBe(3.5);
    // третий — мест в списке нет, в конец
    expect(
      placeNewMeal([m("Завтрак", 1), m("Полдник", 2), m("Обед", 3), m("Полдник", 4), m("Ужин", 5)], "Полдник", plan),
    ).toBe(6);
  });
});

describe("mealToJoin: в какой приём дня встанет запись по названию", () => {
  const m = (id: string, name: string, position: number) => ({ id, name, position });

  it("последний приём дня с этим названием (по позициям)", () => {
    const day = [m("l2", "Обед", 5), m("b", "Завтрак", 1), m("l1", "обед", 2)];
    expect(mealToJoin(day, "Обед")?.id).toBe("l2");
    expect(mealToJoin(day, "Ужин")).toBeUndefined();
    expect(mealToJoin([], "Обед")).toBeUndefined();
  });

  it("«Перекус» — только если он последний в дне", () => {
    expect(mealToJoin([m("s", "Перекус", 1), m("l", "Обед", 2)], "Перекус")).toBeUndefined();
    expect(mealToJoin([m("s1", "Перекус", 1), m("l", "Обед", 2), m("s2", "перекус", 3)], "Перекус")?.id).toBe("s2");
    expect(mealToJoin([m("s", "Перекус", 3), m("l", "Обед", 2)], " ПЕРЕКУС")?.id).toBe("s");
    expect(mealToJoin([], "Перекус")).toBeUndefined();
  });
});

describe("defaultMealTarget: приём по умолчанию", () => {
  const PLAN = DEFAULT_MEAL_PLAN;
  type M = { id: string; name: string; position: number; lastAt: Date | string | null };
  const m = (id: string, name: string, position: number, last: string | null = null): M => ({
    id,
    name,
    position,
    lastAt: last ? at(last) : null,
  });
  const target = (
    dayMeals: M[],
    hhmm: string,
    opts: { isToday?: boolean; plan?: string[]; preferred?: { mealId?: string | null; name?: string | null } | null } = {},
  ) => {
    const [hour, minute] = hhmm.split(":").map(Number);
    return defaultMealTarget({
      dayMeals,
      plan: opts.plan ?? PLAN,
      isToday: opts.isToday ?? true,
      now: at(hhmm),
      nowLocal: { hour, minute },
      preferred: opts.preferred,
    });
  };

  it("1: выбранный приём дня", () => {
    const day = [m("b", "Завтрак", 1, "08:30"), m("l", "Обед", 2, "13:00")];
    expect(target(day, "13:10", { preferred: { mealId: "b" } })).toEqual({ mealId: "b" });
    // чужой или удалённый id — как без выбора
    expect(target(day, "13:10", { preferred: { mealId: "zzz" } })).toEqual({ mealId: "l" });
  });

  it("2: по названию — приём дня с ним (последний из нескольких), иначе новый", () => {
    const day = [m("s1", "Перекус", 1, "11:00"), m("l", "Обед", 2, "13:00"), m("s2", "Перекус", 3, "16:00")];
    expect(target(day, "09:00", { preferred: { name: "обед" } })).toEqual({ mealId: "l" });
    expect(target(day, "09:00", { preferred: { name: "перекус" } })).toEqual({ mealId: "s2" });
    expect(target(day, "09:00", { preferred: { name: "  второй завтрак " } })).toEqual({ name: "Второй завтрак" });
    // пустое название — как без выбора
    expect(target([], "09:00", { preferred: { name: "  " } })).toEqual({ name: "Завтрак" });
  });

  it("2: «Перекус» — к перекусу, только если он последний в дне, иначе новый (в конце дня)", () => {
    const day = [m("s", "Перекус", 1, "11:00"), m("l", "Обед", 2, "13:00")];
    expect(target(day, "16:00", { preferred: { name: "Перекус" } })).toEqual({ name: "Перекус" });
    expect(target([...day, m("s2", "Перекус", 3, "15:00")], "16:00", { preferred: { name: "перекус" } })).toEqual({
      mealId: "s2",
    });
  });

  it("3: сегодня — приём, в который добавляли за последние 90 минут", () => {
    const day = [m("b", "Завтрак", 1, "08:30"), m("l", "Обед", 2, "13:00")];
    expect(target(day, "14:25", {})).toEqual({ mealId: "l" });
    expect(target(day, "14:31", {})).toEqual({ name: "Перекус" }); // до ужина больше двух часов (правило 4)
    // из нескольких недавних — последний по времени, а не по порядку
    const moved = [m("l", "Обед", 1, "13:00"), m("b", "Завтрак", 2, "12:50")];
    expect(target(moved, "13:30", {})).toEqual({ mealId: "l" });
    // запись «из будущего» — в пределах 15 минут
    expect(target([m("d", "Ужин", 1, "19:40")], "19:30", {})).toEqual({ mealId: "d" });
    expect(target([m("d", "Ужин", 1, "20:00")], "19:30", {})).toEqual({ mealId: "d" }); // список пройден → Ужин по часу
    expect(target([m("d", "Кофе", 1, "20:00")], "19:30", {})).toEqual({ name: "Ужин" });
    // ISO-строка из JSON
    expect(target([{ ...m("l", "Обед", 1), lastAt: at("13:00").toISOString() }], "13:30", {})).toEqual({ mealId: "l" });
    // в другой день недавность не в счёт
    expect(target(day, "13:10", { isToday: false })).toEqual({ name: "Ужин" });
    // недавний перекус — он, даже не последний в дне
    expect(target([m("s", "Перекус", 1, "12:40"), m("l", "Обед", 2, "12:00")], "13:00", {})).toEqual({ mealId: "s" });
  });

  it("4: следующий по списку незанятый приём после последнего занятого", () => {
    expect(target([m("b", "Завтрак", 1, "08:30")], "12:00", {})).toEqual({ name: "Обед" });
    expect(target([m("b", "Завтрак", 1, "08:30"), m("l", "Обед", 2, "13:00")], "18:00", {})).toEqual({ name: "Ужин" });
    // назад по списку не возвращается: после обеда — ужин, даже утром в другой день
    expect(target([m("l", "Обед", 1, "13:00")], "08:00", { isToday: false })).toEqual({ name: "Ужин" });
    // приём не из списка не сбивает: последний занятый — «Обед»
    expect(target([m("l", "Обед", 1, "13:00"), m("c", "Кофе", 2, "15:00")], "18:00", {})).toEqual({ name: "Ужин" });
    // порядок — по позициям: «Ужин» передвинут выше «Обеда»
    const plan = ["Завтрак", "Обед", "Полдник", "Ужин"];
    expect(target([m("d", "Ужин", 1, "19:00"), m("l", "Обед", 2, "13:00")], "21:00", { isToday: false, plan })).toEqual({
      name: "Полдник",
    });
  });

  it("4: «Перекус» по порядку не предлагается и места в списке не занимает", () => {
    const day = [m("b", "Завтрак", 1, "08:30"), m("l", "Обед", 2, "13:00"), m("d", "Ужин", 3, "19:00")];
    // после ужина список пройден — по часу: вечером ужин, ночью — новый перекус
    expect(target(day, "21:00", {})).toEqual({ mealId: "d" });
    expect(target(day, "23:30", {})).toEqual({ name: "Перекус" });
    // перекус в списке между завтраком и обедом: после завтрака и перекуса — обед
    const plan = ["Завтрак", "Перекус", "Обед", "Ужин"];
    const morning = [m("b", "Завтрак", 1, "08:30"), m("s", "Перекус", 2, "10:30")];
    expect(target(morning, "12:30", { plan })).toEqual({ name: "Обед" });
    expect(target([m("b", "Завтрак", 1, "08:30")], "12:00", { plan })).toEqual({ name: "Обед" });
  });

  it("4: сегодня до следующего по списку больше двух часов — перекус (в конец дня)", () => {
    const lunch = [m("b", "Завтрак", 1, "08:30"), m("l", "Обед", 2, "13:00")];
    // после обеда: 15:00 и 17:00 — перекус, с 17:30 (ужин в 19:30) — ужин
    expect(target(lunch, "15:00", {})).toEqual({ name: "Перекус" });
    expect(target(lunch, "17:00", {})).toEqual({ name: "Перекус" });
    expect(target(lunch, "17:30", {})).toEqual({ name: "Ужин" });
    // перекус уже последний в дне — к нему
    expect(target([...lunch, m("s", "Перекус", 3, "14:40")], "16:30", {})).toEqual({ mealId: "s" });
    // после завтрака в 10:30 (обед в 13:30) — перекус, в 12:00 — обед
    expect(target([m("b", "Завтрак", 1, "08:30")], "10:30", {})).toEqual({ name: "Перекус" });
    expect(target([m("b", "Завтрак", 1, "08:30")], "12:00", {})).toEqual({ name: "Обед" });
    // в другой день времени нет — по списку; перекус скрыт — по списку; своё название без времени — по списку
    expect(target(lunch, "15:00", { isToday: false })).toEqual({ name: "Ужин" });
    expect(target(lunch, "15:00", { plan: ["Завтрак", "Обед", "Ужин"] })).toEqual({ name: "Ужин" });
    expect(target(lunch, "15:00", { plan: ["Завтрак", "Обед", "Полдник", "Ужин", "Перекус"] })).toEqual({ name: "Полдник" });
  });

  it("4: повторы в списке — второе место «Полдника» — новый приём", () => {
    const plan = ["Завтрак", "Полдник", "Обед", "Полдник", "Ужин"];
    const day = [m("b", "Завтрак", 1, "08:30"), m("s", "Полдник", 2, "11:00"), m("l", "Обед", 3, "13:00")];
    expect(target(day, "16:30", { plan })).toEqual({ name: "Полдник" });
    expect(target([...day, m("s2", "Полдник", 4, "16:30")], "19:00", { plan })).toEqual({ name: "Ужин" });
  });

  it("5: пустой день — приём списка по часу, иначе первый в списке", () => {
    expect(target([], "08:00", {})).toEqual({ name: "Завтрак" });
    expect(target([], "20:00", {})).toEqual({ name: "Ужин" });
    expect(target([], "03:00", {})).toEqual({ name: "Перекус" });
    expect(target([], "03:00", { plan: ["Завтрак", "Обед", "Ужин"] })).toEqual({ name: "Завтрак" });
    // вечером дописываем вчерашний день — «Ужин»
    expect(target([], "21:00", { isToday: false })).toEqual({ name: "Ужин" });
    // в дне только приёмы не из списка или перекусы — тоже по часу
    expect(target([m("c", "Кофе", 1, "07:00")], "13:00", {})).toEqual({ name: "Обед" });
    expect(target([m("s", "Перекус", 1, "07:00")], "13:00", {})).toEqual({ name: "Обед" });
    // по часу — перекус: последний в дне перекус или новый
    expect(target([m("s", "Перекус", 1, "07:00")], "17:00", {})).toEqual({ mealId: "s" });
    expect(target([m("s", "Перекус", 1, "07:00"), m("c", "Кофе", 2, "09:00")], "17:00", {})).toEqual({ name: "Перекус" });
  });

  it("6: список пройден — сегодня по часу, в другой день — последний приём", () => {
    const full = [m("b", "Завтрак", 1, "08:30"), m("l", "Обед", 2, "13:00"), m("s", "Перекус", 3, "16:30"), m("d", "Ужин", 4, "19:00")];
    expect(target(full, "22:00", {})).toEqual({ mealId: "d" });
    // ночью — «Перекус»: дневной перекус не последний — новый, в конце дня
    expect(target(full, "23:30", {})).toEqual({ name: "Перекус" });
    expect(target([...full, m("s2", "Перекус", 5, "21:00")], "23:30", {})).toEqual({ mealId: "s2" });
    expect(target(full, "22:00", { isToday: false })).toEqual({ mealId: "d" });
    const reordered = [m("b", "Завтрак", 1), m("l", "Обед", 2), m("d", "Ужин", 3), m("s", "Перекус", 4)];
    expect(target(reordered, "12:00", { isToday: false })).toEqual({ mealId: "s" });
    // только ужин, утром сегодня — новый «Завтрак»
    expect(target([m("d", "Ужин", 1, "19:00")], "09:00", {})).toEqual({ name: "Завтрак" });
    expect(target([m("d", "Ужин", 1, "19:00")], "09:00", { isToday: false })).toEqual({ mealId: "d" });
  });

  it("6: скрытое название по часу не предлагается — «Перекус», скрыт и он — последний приём", () => {
    const day = [m("b", "Завтрак", 1, "08:30"), m("l", "Обед", 2, "13:00"), m("d", "Ужин", 3, "19:00")];
    // «Перекус» скрыт: ночью — к ужину, а не новый скрытый перекус
    expect(target(day, "23:30", { plan: ["Завтрак", "Обед", "Ужин"] })).toEqual({ mealId: "d" });
    // перекус уже есть в дне последним — к нему, хоть он и скрыт
    expect(target([...day, m("s", "Перекус", 4, "21:00")], "23:30", { plan: ["Завтрак", "Обед", "Ужин"] })).toEqual({ mealId: "s" });
    // «Ужин» скрыт: вечером после обеда — новый «Перекус» (в конце дня), а не скрытый ужин
    const lunch = day.slice(0, 2);
    expect(target(lunch, "19:30", { plan: ["Завтрак", "Обед", "Перекус"] })).toEqual({ name: "Перекус" });
    // скрыты и ужин, и перекус — последний приём дня
    expect(target(lunch, "19:30", { plan: ["Завтрак", "Обед"] })).toEqual({ mealId: "l" });
    // начатый приём со скрытым названием — к нему
    expect(target(day, "21:00", { plan: ["Завтрак", "Обед"] })).toEqual({ mealId: "d" });
  });
});

describe("mealLabels", () => {
  it("одинаковые названия нумеруются, единственные — без номера", () => {
    expect(mealLabels([{ name: "Перекус" }, { name: "Обед" }, { name: "Перекус" }, { name: "Перекус" }])).toEqual([
      "Перекус",
      "Обед",
      "Перекус · 2",
      "Перекус · 3",
    ]);
    expect(mealLabels([{ name: "Завтрак" }, { name: "Обед" }])).toEqual(["Завтрак", "Обед"]);
    expect(mealLabels([])).toEqual([]);
  });
});
