import "server-only";
import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { listEntries } from "@/db/entries";
import { dayMeals, weeklyReports, weightLog } from "@/db/schema";
import { addDays, dayRange, todayIn, weekDates, weekStart } from "@/domain/day";
import type { Norms } from "@/domain/norms";
import { buildWeekReport, type DayEntry, summarizeWeek, type WeekReport } from "@/domain/week";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NutrientKey } from "@/domain/nutrients";
import { loadUser } from "./norms";

let densityCache: Partial<Record<NutrientKey, number>> | undefined;
/** 90-й процентиль плотности нутриентов (scripts/foods/import-usda.ts). */
function densities() {
  try {
    densityCache ??= JSON.parse(readFileSync(path.join(process.cwd(), "seed/foods/density.json"), "utf8"));
  } catch {
    densityCache = {};
  }
  return densityCache;
}

/** Последняя закончившаяся неделя (понедельник). */
export const lastCompleteWeek = (tz: string) => addDays(weekStart(todayIn(tz)), -7);

/** Записи по местным дням (день записи — день её приёма пищи, как на экране дня). */
async function entriesByLocalDate(ownerId: string, from: string, days: number): Promise<DayEntry[]> {
  const rows = await listEntries(db, ownerId, from, addDays(from, days - 1));
  return rows.map((e) => ({ date: e.date, nutrients: e.nutrients }));
}

/** Изменение веса за неделю: последнее взвешивание недели − последнее до неё. */
async function weightChange(ownerId: string, monday: string, tz: string): Promise<number | null> {
  const start = dayRange(monday, tz).start;
  const end = dayRange(addDays(monday, 6), tz).end;
  const last = (before: Date, after?: Date) =>
    db
      .select({ kg: weightLog.weightKg })
      .from(weightLog)
      .where(and(eq(weightLog.ownerId, ownerId), lt(weightLog.measuredAt, before), after ? gte(weightLog.measuredAt, after) : undefined))
      .orderBy(desc(weightLog.measuredAt))
      .limit(1);
  const [[inWeek], [beforeWeek]] = await Promise.all([last(end, start), last(start)]);
  return inWeek && beforeWeek ? Math.round((inWeek.kg - beforeWeek.kg) * 10) / 10 : null;
}

/**
 * Разбор недели. Нормы — снимок, сохранённый при первом открытии разбора этой
 * недели: смена цели потом не переписывает оценку прошлого. Сам разбор
 * пересчитывается при каждом открытии — правки дневника задним числом видны.
 */
export async function loadWeekReport(ownerId: string, monday: string, tz: string) {
  const { state, norms: current } = await loadUser(ownerId);
  if (!current || !state.goal) return null;

  const [stored] = await db
    .select()
    .from(weeklyReports)
    .where(and(eq(weeklyReports.ownerId, ownerId), eq(weeklyReports.weekStart, monday)));
  const norms = (stored?.norms as Norms | undefined) ?? current;

  const prevMonday = addDays(monday, -7);
  const [all, weightKg] = await Promise.all([entriesByLocalDate(ownerId, prevMonday, 14), weightChange(ownerId, monday, tz)]);
  const report: WeekReport = buildWeekReport(monday, {
    week: summarizeWeek(weekDates(monday), all, norms),
    prev: summarizeWeek(weekDates(prevMonday), all, norms),
    norms,
    goal: state.goal.kind,
    rateKgPerWeek: state.goal.rateKgPerWeek,
    weightChangeKg: weightKg,
    densities: densities(),
  });

  // Снимок норм и кэш — только для закончившихся недель.
  if (monday < weekStart(todayIn(tz))) {
    await db
      .insert(weeklyReports)
      .values({ ownerId, weekStart: monday, norms, payload: report })
      .onConflictDoUpdate({ target: [weeklyReports.ownerId, weeklyReports.weekStart], set: { payload: report } });
  }
  return { report, seen: stored?.seenAt != null };
}

/** Разбор недели просмотрен: больше не открывать его сам (строку разбора создаёт loadWeekReport). */
export async function markWeekSeen(ownerId: string, monday: string) {
  await db
    .update(weeklyReports)
    .set({ seenAt: new Date() })
    .where(and(eq(weeklyReports.ownerId, ownerId), eq(weeklyReports.weekStart, monday)));
}

/**
 * Показать ли разбор при открытии приложения: прошлая неделя закончилась,
 * в ней хотя бы 3 дня с записями, и разбор ещё не видели (открывшийся разбор
 * отмечается просмотренным ещё до показа — week/page.tsx, markWeekSeen).
 */
export async function shouldShowWeek(ownerId: string, tz: string): Promise<boolean> {
  const monday = lastCompleteWeek(tz);
  const [report] = await db
    .select({ seenAt: weeklyReports.seenAt })
    .from(weeklyReports)
    .where(and(eq(weeklyReports.ownerId, ownerId), eq(weeklyReports.weekStart, monday)));
  if (report?.seenAt) return false;
  // Пустых приёмов не бывает: день с приёмом пищи — день с записями.
  const [{ days }] = await db
    .select({ days: sql<number>`count(distinct ${dayMeals.date})` })
    .from(dayMeals)
    .where(and(eq(dayMeals.ownerId, ownerId), gte(dayMeals.date, monday), lte(dayMeals.date, addDays(monday, 6))));
  return Number(days) >= 3;
}
