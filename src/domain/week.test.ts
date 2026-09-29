import { describe, expect, it } from "vitest";
import { weekDates, weekStart, weekTitle } from "./day";
import { computeNorms } from "./norms";
import type { NutrientVector } from "./nutrients";
import { buildWeekReport, type DayEntry, summarizeWeek, type WeekContext } from "./week";

// Мужчина 30 лет, 180 см, 80 кг, средняя активность, удержание:
// 2760 ккал, коридор 2480–3040, белок ≥ 112 г, витамин D ≥ 15 мкг.
const norms = computeNorms({ sex: "male", age: 30, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain" });
const MON = "2026-09-21";
const DATES = weekDates(MON);
const PREV = weekDates("2026-09-14");

/** Одна запись на день с заданными нутриентами. */
const days = (dates: string[], perDay: (i: number) => NutrientVector | null): DayEntry[] =>
  dates.flatMap((date, i) => {
    const n = perDay(i);
    return n ? [{ date, nutrients: n }] : [];
  });

/** Полный «хороший» день: всё известно, всё в норме. */
const fullDay = (over: NutrientVector = {}): NutrientVector => ({
  kcal: 2750, protein: 120, fat: 90, carbs: 330, fiber: 28, sodium: 1800,
  vitA: 1000, vitC: 120, vitD: 16, vitE: 16, vitK: 130, b1: 1.6, b2: 2, b6: 2.2, b9: 450, b12: 4,
  calcium: 1100, iron: 12, magnesium: 450, potassium: 3600, zinc: 13, selenium: 80, omega3: 3,
  ...over,
});

function report(entries: DayEntry[], opts: Partial<WeekContext> & { prevEntries?: DayEntry[] } = {}) {
  const week = summarizeWeek(DATES, entries, norms);
  const prev = opts.prevEntries ? summarizeWeek(PREV, opts.prevEntries, norms) : null;
  return buildWeekReport(MON, {
    week, prev, norms, goal: "maintain", weightChangeKg: null, rateKgPerWeek: null, ...opts,
  });
}

describe("недели", () => {
  it("понедельник, даты, заголовок", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // воскресенье
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
    expect(DATES.at(-1)).toBe("2026-09-27");
    expect(weekTitle("2026-09-21")).toBe("21–27 сентября");
    expect(weekTitle("2026-09-28")).toBe("28 сентября – 4 октября");
  });
});

describe("summarizeWeek", () => {
  it("неполные дни (< 40 % нормы) не идут в средние; полнота данных — по калориям", () => {
    const entries: DayEntry[] = [
      { date: DATES[0], nutrients: { kcal: 2000, protein: 100, vitD: 10 } },
      { date: DATES[0], nutrients: { kcal: 1000, protein: 20, vitD: null } },
      { date: DATES[1], nutrients: { kcal: 500, protein: 10 } }, // неполный
    ];
    const s = summarizeWeek(DATES, entries, norms);
    expect(s.loggedDays).toBe(2);
    expect(s.completeDays.map((d) => d.date)).toEqual([DATES[0]]);
    expect(s.avg.kcal).toBe(3000);
    expect(s.avg.vitD).toBe(10);
    expect(s.coverage.vitD).toBeCloseTo(2 / 3);
  });
});

describe("«Что получилось» — как на скриншоте", () => {
  it("полная неделя в коридоре с белком", () => {
    const r = report(days(DATES, (i) => fullDay({ protein: i < 5 ? 120 : 90 })));
    expect(r.loggedDays).toBe(7);
    expect(r.avgKcal).toBe(2750);
    expect(r.good).toEqual([
      "Дневник вели 7 дней из семи — разбору есть на что опереться.",
      "7 дней из 7 попали в коридор нормы.",
      "Белок добран в 5 из 7 дней.",
    ]);
    expect(r.watch).toEqual([]);
    expect(r.topUp).toEqual([]);
    expect(r.note).toBeNull();
  });

  it("разрыв с нормой сократился против недели раньше", () => {
    const r = report(days(DATES, () => fullDay({ kcal: 2700 })), {
      prevEntries: days(PREV, () => fullDay({ kcal: 3300 })),
    });
    expect(r.good).toContain("Разрыв с нормой сократился на 89% против недели раньше.");
  });

  it("вес в темпе цели", () => {
    const r = report(days(DATES, () => fullDay()), { goal: "lose", rateKgPerWeek: 0.5, weightChangeKg: -0.4 });
    expect(r.good).toContain("Вес −0,4 кг за неделю — в темпе цели.");
  });
});

describe("«На что посмотреть»", () => {
  it("мало записанных дней и неполный день", () => {
    const r = report(days(DATES, (i) => (i < 2 ? fullDay() : i === 2 ? { kcal: 400 } : null)));
    expect(r.watch[0]).toBe("Дневник вели 3 дня из семи — выводы приблизительные (1 день записан не полностью).");
    expect(r.completeDays).toBe(2);
  });

  it("калории выше коридора", () => {
    const r = report(days(DATES, () => fullDay({ kcal: 3300 })));
    expect(r.watch).toContain("В среднем 3 300 ккал в день — выше коридора нормы (2 480–3 040).");
  });

  it("при снижении — слишком большой дефицит", () => {
    const r = report(days(DATES, () => fullDay({ kcal: 1800 })), { goal: "lose" });
    expect(r.watch.some((w) => w.includes("слишком большой дефицит"))).toBe(true);
  });

  it("мало белка", () => {
    const r = report(days(DATES, () => fullDay({ protein: 70 })));
    expect(r.watch).toContain("Белок добран только в 0 из 7 дней: в среднем 70 г при норме 112 г.");
  });

  it("калории ушли от нормы по сравнению с неделей раньше", () => {
    const r = report(days(DATES, () => fullDay({ kcal: 3000 })), { prevEntries: days(PREV, () => fullDay({ kcal: 2750 })) });
    expect(r.watch).toContain("Калорий на 9% больше, чем неделей раньше.");
  });

  it("натрий выше предела — только если он превышен уже по известным данным", () => {
    expect(report(days(DATES, () => fullDay({ sodium: 3200 }))).watch.some((w) => w.startsWith("Натрия в среднем 3 200 мг"))).toBe(true);
    expect(report(days(DATES, () => fullDay({ sodium: 1900 }))).watch).toEqual([]);
  });

  it("вес уходит быстрее цели", () => {
    const r = report(days(DATES, () => fullDay()), { goal: "lose", rateKgPerWeek: 0.5, weightChangeKg: -1.8 });
    expect(r.watch.some((w) => w.startsWith("Вес −1,8 кг за неделю — быстрее цели"))).toBe(true);
  });
});

describe("«Чем добрать»", () => {
  it("недобор с полными данными — с источниками, самые большие первыми, не больше трёх", () => {
    const r = report(days(DATES, () => fullDay({ vitD: 3, vitK: 40, calcium: 500, magnesium: 250 })));
    expect(r.topUp.map((t) => t.text)).toEqual([
      "Витамин D: жирная рыба, яйца, добавка D3",
      "Витамин K: зелень, капуста, брокколи",
      "Кальций: творог, сыр, кефир, кунжут",
    ]);
  });

  it("творог без кальция в составе: мнимого недобора кальция нет", () => {
    // Кальций по известным данным — 600 мг (60 % нормы), но 250 ккал в день —
    // творог и кефир без состава; при плотности 1,39 мг/ккал это до +348 мг.
    const entries = DATES.flatMap((date) => [
      { date, nutrients: fullDay({ kcal: 2500, calcium: 600 }) },
      { date, nutrients: { kcal: 250, protein: 33, fat: 10, carbs: 6, calcium: null } },
    ]);
    expect(report(entries, { densities: { calcium: 1.39 } }).topUp).toEqual([]);
    // Без творога (всё известно) те же 600 мг — настоящий недобор.
    expect(report(days(DATES, () => fullDay({ calcium: 600 })), { densities: { calcium: 1.39 } }).topUp[0].nutrient).toBe("calcium");
  });

  it("неполные данные: недобор не объявляется, если с поправкой он может быть мнимым", () => {
    // Витамин C известен у продуктов на 80 % калорий, по ним 60 % нормы →
    // оценка сверху 75 % — меньше порога не доказано, молчим.
    const entries = DATES.flatMap((date) => [
      { date, nutrients: fullDay({ kcal: 2200, vitC: 60 }) },
      { date, nutrients: { kcal: 550, protein: 5, fat: 10, carbs: 100, vitC: null } },
    ]);
    expect(report(entries).topUp).toEqual([]);
  });

  it("нет данных по многим нутриентам — не гадаем, пишем сноску", () => {
    const r = report(days(DATES, () => ({ kcal: 2750, protein: 120, fat: 90, carbs: 330 })));
    expect(r.topUp).toEqual([]);
    expect(r.note).toBe("По 18 нутриентам данных мало: у части продуктов не указан состав.");
  });
});
