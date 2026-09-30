import "server-only";
import { db } from "@/db";
import { listEntries } from "@/db/entries";
import { addDays, weekStart } from "@/domain/day";

/**
 * Калории по местным дням недели (с понедельника), в которую входит date, —
 * для точек полосы недели на экране дневника. День записи — день её приёма
 * пищи, как на экране дня. Одним запросом; в словаре только дни с записями:
 * { "2026-09-28": 2310, "2026-09-30": 840 }.
 */
export async function loadWeekKcal(ownerId: string, date: string): Promise<Record<string, number>> {
  const monday = weekStart(date);
  const out: Record<string, number> = {};
  for (const e of await listEntries(db, ownerId, monday, addDays(monday, 6))) {
    out[e.date] = (out[e.date] ?? 0) + (e.nutrients.kcal ?? 0);
  }
  return out;
}
