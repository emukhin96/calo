// Будущих дней в дневнике нет: главный экран и «Добавить» не открывают их, а
// POST /api/entries не создаёт в них записи — такую запись нельзя было бы ни
// открыть, ни поправить, ни удалить. «Сегодня» — в часовом поясе профиля.
import { isIsoDate, todayIn } from "@/domain/day";

/** День дневника из ?d= (/, /add): не дата или позже сегодня — сегодня. */
export function diaryDateOf(d: unknown, today: string): string {
  return typeof d === "string" && isIsoDate(d) && d <= today ? d : today;
}

/** Часы телефона принимаем в пределах двух суток: запись могла ждать в офлайн-очереди. */
const CLIENT_CLOCK_MS = 48 * 3600_000;

/**
 * День и время новой записи из того, что прислал клиент (POST /api/entries) —
 * для db/entries.ts createEntry.
 *
 * - eatenAt (когда съедено по часам телефона) — в пределах двух суток от «сейчас»
 *   и не в будущем дне: без date по нему выбирался бы день записи.
 * - date позже сегодня → сегодня, а не 400: офлайн-очередь выбрасывает запись на
 *   4xx, а телефон, у которого часы или пояс впереди профиля, законно ставит в
 *   очередь «завтра». Время «HH:MM» такой записи отброшено: оно по часам телефона
 *   и относится к дню, который у профиля ещё не начался, — время решат eatenAt
 *   (если он сегодня) или «сейчас».
 * - С mealId день решает сам приём (createEntry: date другого дня — 400), а
 *   приёмов в будущих днях не бывает. «Будущая» date с mealId (пояс профиля
 *   сменился, пока запись ждала в очереди) отбрасывается — иначе 400 и запись
 *   потеряна; день берётся у приёма.
 */
export function newEntryTiming(
  input: { date?: string; time?: string; eatenAt?: string; mealId?: string },
  { tz, now }: { tz: string; now: Date },
): { date?: string; time?: string; eatenAt: Date | null } {
  const today = todayIn(tz, now);
  const at = input.eatenAt ? new Date(input.eatenAt) : null;
  const eatenAt =
    at && Math.abs(now.getTime() - at.getTime()) < CLIENT_CLOCK_MS && todayIn(tz, at) <= today ? at : null;
  if (input.date && input.date > today) return { date: input.mealId ? undefined : today, eatenAt };
  return { date: input.date, time: input.time, eatenAt };
}
