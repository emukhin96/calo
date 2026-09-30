import "server-only";
import { db } from "@/db";
import { kcalByDay } from "@/db/entries";
import { addDays, weekStart } from "@/domain/day";

/**
 * Калории по местным дням недели (с понедельника), в которую входит date, —
 * для точек полосы недели на экране дневника. День записи — день её приёма
 * пищи, как на экране дня. Одним агрегатом в базе; в словаре только дни с
 * записями: { "2026-09-28": 2310, "2026-09-30": 840 }.
 */
export async function loadWeekKcal(ownerId: string, date: string): Promise<Record<string, number>> {
  const monday = weekStart(date);
  const days = await kcalByDay(db, ownerId, monday, addDays(monday, 6));
  return Object.fromEntries(days.map((d) => [d.date, d.kcal]));
}
