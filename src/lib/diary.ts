import "server-only";
import { db } from "@/db";
import { type DayData, loadDayData } from "@/db/entries";

export type { DayData, DayMealView, Entry } from "@/db/entries";

/**
 * День дневника: приёмы пищи дня по порядку (day_meals) с записями и итогами —
 * общий код экрана дня и GET /api/entries.
 */
export async function loadDay(ownerId: string, date: string, tz: string): Promise<DayData> {
  return loadDayData(db, ownerId, date, tz);
}
