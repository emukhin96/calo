import "server-only";
import { db } from "@/db";
import { listEntries } from "@/db/entries";
import { dayRange } from "@/domain/day";
import { sum } from "@/domain/nutrients";

/** День дневника: записи и итоги — общий код страницы «Сегодня» и GET /api/entries. */
export async function loadDay(ownerId: string, date: string, tz: string) {
  const items = await listEntries(db, ownerId, dayRange(date, tz));
  return { date, entries: items, totals: sum(items.map((e) => e.nutrients)) };
}
