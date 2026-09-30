import { describe, expect, it } from "vitest";
import { DEFAULT_MEAL_PLAN } from "@/domain/meals";
import {
  type DayMeal,
  defaultMealChoice,
  isMealChoiceValid,
  localClock,
  mealChoiceBody,
  newMealChoice,
  newMealIndex,
  newMealName,
  newMealTime,
  nowTime,
  shortTime,
  toDayMeals,
  typicalMealTime,
} from "./meal-choice";

/** Местное время 30 сентября по часам телефона (тесты идут в любом поясе). */
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2026, 8, 30, h, m);
};

/** Приём дня: последняя запись — в last (местное «HH:MM») или нет записей. */
const meal = (id: string, name: string, last: string | null = null, kcal = 100): DayMeal => ({
  id,
  name,
  label: name,
  time: last,
  kcal,
  lastAt: last ? at(last).toISOString() : null,
});

const PLAN = DEFAULT_MEAL_PLAN;

describe("toDayMeals", () => {
  const view = (id: string, name: string, time: string | null, kcal?: number | null) => ({
    id,
    name,
    position: 1,
    time,
    lastAt: time ? at(time) : null,
    entries: [],
    totals: kcal === undefined ? {} : { kcal },
  });

  it("по порядку, повторы нумеруются, времени нет", () => {
    const out = toDayMeals(
      [view("a", "Завтрак", "08:30", 420.4), view("b", "Перекус", "11:00", null), view("c", "Обед", "13:05"), view("d", "Перекус", "16:40", 90)],
      false,
    );
    expect(out.map((m) => m.label)).toEqual(["Завтрак", "Перекус", "Обед", "Перекус · 2"]);
    expect(out[0]).toEqual({ id: "a", name: "Завтрак", label: "Завтрак", time: "08:30", kcal: 420.4, lastAt: at("08:30").toISOString() });
    expect(out[1].kcal).toBe(0);
    expect(out[2].kcal).toBe(0);
  });

  it("с показом времени — время в подписи вместо номера", () => {
    const out = toDayMeals([view("a", "Завтрак", "08:30"), view("b", "Перекус", "11:00"), view("d", "перекус", "16:40")], true);
    expect(out.map((m) => m.label)).toEqual(["Завтрак 8:30", "Перекус 11:00", "перекус 16:40"]);
    // одинаковые название и время — номер остаётся
    const twins = toDayMeals([view("a", "Перекус", "11:00"), view("b", "Перекус", "11:00")], true);
    expect(twins.map((m) => m.label)).toEqual(["Перекус 11:00", "Перекус · 2 11:00"]);
  });

  it("приём без записей и lastAt строкой из JSON", () => {
    const [m] = toDayMeals([{ id: "x", name: "Ужин", time: null, lastAt: "2026-09-30T16:00:00.000Z", totals: { kcal: 5 } }], true);
    expect(m).toEqual({ id: "x", name: "Ужин", label: "Ужин", time: null, kcal: 5, lastAt: "2026-09-30T16:00:00.000Z" });
    expect(toDayMeals([], true)).toEqual([]);
  });
});

describe("defaultMealChoice", () => {
  const day = [meal("b", "Завтрак", "08:30"), meal("l", "Обед", "13:00")];

  it("приём из ссылки: по id, по названию, новый", () => {
    expect(defaultMealChoice({ meals: day, plan: PLAN, isToday: true, now: at("20:00"), preferred: { mealId: "b" } })).toEqual({
      kind: "existing",
      mealId: "b",
      name: "Завтрак",
    });
    expect(defaultMealChoice({ meals: day, plan: PLAN, isToday: true, now: at("20:00"), preferred: { name: "обед" } })).toEqual({
      kind: "existing",
      mealId: "l",
      name: "Обед",
    });
    expect(defaultMealChoice({ meals: day, plan: PLAN, isToday: false, now: at("09:00"), preferred: { name: " ужин " } })).toEqual({
      kind: "new",
      name: "Ужин",
      time: null,
      again: false,
    });
    // удалённый приём из старой ссылки — как без выбора
    expect(defaultMealChoice({ meals: day, plan: PLAN, isToday: true, now: at("13:30"), preferred: { mealId: "gone" } })).toEqual({
      kind: "existing",
      mealId: "l",
      name: "Обед",
    });
  });

  it("из нескольких одноимённых — последний по порядку", () => {
    const snacks = [meal("s1", "Перекус", "11:00"), meal("l", "Обед", "13:00"), meal("s2", "Перекус", "10:00")];
    expect(defaultMealChoice({ meals: snacks, plan: PLAN, isToday: false, now: at("09:00"), preferred: { name: "Перекус" } })).toEqual({
      kind: "existing",
      mealId: "s2",
      name: "Перекус",
    });
  });

  it("сегодня — приём, в который добавляли за последние 90 минут", () => {
    expect(defaultMealChoice({ meals: day, plan: PLAN, isToday: true, now: at("14:20") })).toEqual({ kind: "existing", mealId: "l", name: "Обед" });
    expect(defaultMealChoice({ meals: day, plan: PLAN, isToday: true, now: at("14:31") })).toEqual({
      kind: "new",
      name: "Перекус",
      time: null,
      again: false,
    });
  });

  it("дальше — следующий по списку пользователя, в пустой день — по часу", () => {
    expect(defaultMealChoice({ meals: day, plan: PLAN, isToday: false, now: at("14:20") })).toEqual({
      kind: "new",
      name: "Перекус",
      time: null,
      again: false,
    });
    const plan = ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин"];
    expect(defaultMealChoice({ meals: [meal("b", "Завтрак", "08:30")], plan, isToday: false, now: at("21:00") })).toEqual({
      kind: "new",
      name: "Второй завтрак",
      time: null,
      again: false,
    });
    expect(defaultMealChoice({ meals: [], plan: PLAN, isToday: true, now: at("20:15") })).toEqual({
      kind: "new",
      name: "Ужин",
      time: null,
      again: false,
    });
    expect(defaultMealChoice({ meals: [], plan: ["Обед", "Ужин"], isToday: true, now: at("08:00") })).toEqual({
      kind: "new",
      name: "Обед",
      time: null,
      again: false,
    });
    // второе место «Перекуса» в списке: такой приём в дне уже есть — нужен ещё один
    const twice = ["Завтрак", "Перекус", "Обед", "Перекус", "Ужин"];
    const three = [meal("b", "Завтрак", "08:30"), meal("s", "Перекус", "11:00"), meal("l", "Обед", "13:00")];
    expect(defaultMealChoice({ meals: three, plan: twice, isToday: false, now: at("15:00") })).toEqual({
      kind: "new",
      name: "Перекус",
      time: null,
      again: true,
    });
  });

  it("список пройден: в другой день — последний приём", () => {
    const full = [meal("b", "Завтрак", "08:30"), meal("l", "Обед", "13:00"), meal("s", "Перекус", "16:00"), meal("d", "Ужин", "19:00")];
    expect(defaultMealChoice({ meals: full, plan: PLAN, isToday: false, now: at("10:00") })).toEqual({ kind: "existing", mealId: "d", name: "Ужин" });
  });

  it("порядок — как пришли приёмы (позиции), а не время", () => {
    // «Ужин» передвинут наверх: последний по порядку приём из списка — «Завтрак», за ним по списку — «Обед».
    const moved = [meal("d", "Ужин", "19:00"), meal("b", "Завтрак", "08:30")];
    expect(defaultMealChoice({ meals: moved, plan: PLAN, isToday: false, now: at("12:00") })).toEqual({
      kind: "new",
      name: "Обед",
      time: null,
      again: false,
    });
  });
});

describe("новый приём", () => {
  it("newMealName: следующий по списку, иначе по часу", () => {
    const day = [meal("b", "Завтрак", "08:30"), meal("l", "Обед", "13:00")];
    // недавний «Обед» не мешает: нужен именно новый
    expect(newMealName({ meals: day, plan: PLAN, now: at("13:10") })).toBe("Перекус");
    expect(newMealName({ meals: [], plan: PLAN, now: at("08:00") })).toBe("Завтрак");
    const full = [meal("b", "Завтрак"), meal("l", "Обед"), meal("s", "Перекус"), meal("d", "Ужин")];
    expect(newMealName({ meals: full, plan: PLAN, now: at("21:00") })).toBe("Ужин");
    expect(newMealName({ meals: full, plan: PLAN, now: at("17:00") })).toBe("Перекус");
    // после последнего занятого мест нет — незанятое раньше (по часу, если свободно), а не второй «Ужин»
    const dinner = [meal("d", "Ужин")];
    expect(newMealName({ meals: dinner, plan: PLAN, now: at("21:00") })).toBe("Завтрак");
    expect(newMealName({ meals: dinner, plan: PLAN, now: at("13:00") })).toBe("Обед");
    // повтор в списке — второе место «Перекуса»
    const plan = ["Завтрак", "Перекус", "Обед", "Перекус", "Ужин"];
    expect(newMealName({ meals: [meal("b", "Завтрак"), meal("s", "Перекус"), meal("l", "Обед")], plan, now: at("10:00") })).toBe(
      "Перекус",
    );
  });

  it("newMealChoice: again — такой приём в дне уже есть", () => {
    const day = [meal("b", "Завтрак"), meal("s", "Перекус")];
    expect(newMealChoice(day, "перекус")).toEqual({ kind: "new", name: "перекус", time: null, again: true });
    expect(newMealChoice(day, "Обед", "13:05")).toEqual({ kind: "new", name: "Обед", time: "13:05", again: false });
    expect(newMealChoice(day, "  ")).toEqual({ kind: "new", name: "  ", time: null, again: false });
    expect(newMealChoice([], "Ужин")).toEqual({ kind: "new", name: "Ужин", time: null, again: false });
  });

  it("newMealIndex: куда встанет по списку", () => {
    const day = [meal("b", "Завтрак"), meal("d", "Ужин")];
    expect(newMealIndex(day, "Обед", PLAN)).toBe(1);
    expect(newMealIndex(day, "перекус", PLAN)).toBe(1);
    expect(newMealIndex([meal("l", "Обед")], "Завтрак", PLAN)).toBe(0);
    expect(newMealIndex(day, "Ужин", PLAN)).toBe(2); // второй «Ужин» — места в списке нет, в конец
    expect(newMealIndex(day, "Кофе", PLAN)).toBe(2);
    expect(newMealIndex([], "Обед", PLAN)).toBe(0);
    // приём не из списка остаётся на месте: «Обед» — после «Кофе»
    expect(newMealIndex([meal("b", "Завтрак"), meal("c", "Кофе"), meal("d", "Ужин")], "Обед", PLAN)).toBe(2);
  });

  it("typicalMealTime: как решит сервер в прошлый день", () => {
    expect(typicalMealTime("Ужин")).toBe("19:30");
    expect(typicalMealTime("завтрак")).toBe("08:30");
    expect(typicalMealTime("Полдник")).toBe("13:30");
    expect(typicalMealTime("")).toBe("13:30");
  });

  it("newMealTime: сегодня — «сейчас», в другой день — по названию", () => {
    expect(newMealTime(true, at("7:05"))).toBe("07:05");
    expect(newMealTime(false, at("7:05"))).toBeUndefined();
  });
});

describe("mealChoiceBody и проверка выбора", () => {
  it("начатый приём — только id", () => {
    expect(mealChoiceBody({ kind: "existing", mealId: "m1" })).toEqual({ mealId: "m1" });
    // с названием — запасной путь для офлайн-очереди, если приём удалят
    expect(mealChoiceBody({ kind: "existing", mealId: "m1", name: "Обед" })).toEqual({ mealId: "m1", mealName: "Обед" });
  });

  it("новый — нормализованное название, newMeal и время, если выставлено", () => {
    expect(mealChoiceBody({ kind: "new", name: " второй  завтрак ", time: "9:05" })).toEqual({
      mealName: "Второй завтрак",
      newMeal: true,
      time: "09:05",
    });
    expect(mealChoiceBody({ kind: "new", name: "ОБЕД", time: null })).toEqual({ mealName: "Обед", newMeal: true });
    expect(mealChoiceBody({ kind: "new", name: "Перекус", time: "25:00" })).toEqual({ mealName: "Перекус", newMeal: true });
  });

  it("такого приёма в дне нет — без newMeal: устаревший день (офлайн) не заведёт второй такой же", () => {
    expect(mealChoiceBody({ kind: "new", name: "обед", time: null, again: false })).toEqual({ mealName: "Обед" });
    expect(mealChoiceBody({ kind: "new", name: "Обед", time: "13:05", again: false })).toEqual({ mealName: "Обед", time: "13:05" });
    expect(mealChoiceBody({ kind: "new", name: "Перекус", time: null, again: true })).toEqual({ mealName: "Перекус", newMeal: true });
    // выбор по умолчанию в пустой день
    expect(mealChoiceBody(defaultMealChoice({ meals: [], plan: PLAN, isToday: false, now: at("09:00") }))).toEqual({
      mealName: "Завтрак",
    });
  });

  it("пустое название — по часу времени; отправлять такой выбор нельзя", () => {
    expect(mealChoiceBody({ kind: "new", name: "  ", time: "20:00" })).toEqual({ mealName: "Ужин", newMeal: true, time: "20:00" });
    expect(isMealChoiceValid({ kind: "new", name: "  ", time: null })).toBe(false);
    expect(isMealChoiceValid({ kind: "new", name: "Полдник", time: null })).toBe(true);
    expect(isMealChoiceValid({ kind: "existing", mealId: "m1" })).toBe(true);
    expect(isMealChoiceValid({ kind: "existing", mealId: "" })).toBe(false);
  });
});

describe("мелочи", () => {
  it("shortTime / nowTime / localClock", () => {
    expect(shortTime("08:30")).toBe("8:30");
    expect(shortTime("13:05")).toBe("13:05");
    expect(shortTime("00:00")).toBe("0:00");
    expect(nowTime(new Date(2026, 8, 29, 7, 5))).toBe("07:05");
    expect(nowTime(new Date(2026, 8, 29, 23, 59))).toBe("23:59");
    expect(localClock(new Date(2026, 8, 29, 7, 5))).toEqual({ hour: 7, minute: 5 });
  });
});
