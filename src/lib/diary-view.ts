// Экран дневника «Лента»: полоса недели, сводка дня и ссылки в «Добавить».
// Чистая логика без React и БД — для страницы, клиентских частей и тестов
// (./diary-view.test.ts).
import { addDays, weekDates, weekStart } from "@/domain/day";
import { formatInt } from "@/domain/text";

const WD = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** Калории дня относительно коридора нормы: ниже, в коридоре, выше. */
export type KcalStatus = "below" | "ok" | "above";

export function kcalStatus(kcal: number, [lo, hi]: [number, number]): KcalStatus {
  if (kcal > hi) return "above";
  return kcal >= lo ? "ok" : "below";
}

export type StripDay = {
  date: string;
  /** «пн» … «вс». */
  weekday: string;
  /** Число месяца: 1…31. */
  day: number;
  selected: boolean;
  today: boolean;
  /** Будущий день — не ссылка. */
  future: boolean;
  /** null — записей в этот день нет (точки нет). */
  status: KcalStatus | null;
};

/**
 * Полоса недели с понедельника, в которую входит date: дни, выбранный,
 * сегодня, будущие; точка — у дней с записями (kcalByDate — только они).
 * prev / next — день на неделю раньше / позже для стрелок; next — не позже
 * сегодня и null, если следующая неделя целиком в будущем.
 */
export function weekStrip(
  date: string,
  today: string,
  kcalByDate: Record<string, number>,
  range: [number, number],
): { days: StripDay[]; prev: string; next: string | null } {
  const monday = weekStart(date);
  const days = weekDates(monday).map((d, i) => ({
    date: d,
    weekday: WD[i],
    day: Number(d.slice(8, 10)),
    selected: d === date,
    today: d === today,
    future: d > today,
    status: d in kcalByDate ? kcalStatus(kcalByDate[d], range) : null,
  }));
  const later = addDays(date, 7);
  const next = addDays(monday, 7) > today ? null : later > today ? today : later;
  return { days, prev: addDays(date, -7), next };
}

/** «осталось 620 ккал», «осталось 150 ккал · в коридоре нормы», «сверх нормы 380 ккал». */
export function remaining(eaten: number, norm: number, [lo, hi]: [number, number]): string {
  if (eaten > hi) return `сверх нормы ${formatInt(eaten - norm)} ккал`;
  if (eaten > norm) return `в коридоре нормы · +${formatInt(eaten - norm)} ккал`;
  return `осталось ${formatInt(norm - eaten)} ккал${eaten >= lo ? " · в коридоре нормы" : ""}`;
}

/**
 * Ссылка в «Добавить»: /add?d=2026-09-30 — просто добавить; meal — в этот
 * приём дня (его id) или в приём с этим названием («Обед»: уже начатый в дне,
 * иначе новый); text — разобрать описание («творог 180, кофе»).
 */
export function addHref(date: string, opts: { meal?: string; text?: string } = {}): string {
  // encodeURIComponent, а не URLSearchParams: пробел — %20, а не «+», его
  // одинаково поймут и searchParams страницы, и ручной decodeURIComponent.
  let href = `/add?d=${date}`;
  if (opts.meal) href += `&meal=${encodeURIComponent(opts.meal)}`;
  if (opts.text) href += `&text=${encodeURIComponent(opts.text)}`;
  return href;
}
