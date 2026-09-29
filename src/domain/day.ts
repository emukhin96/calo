// Календарные дни в часовом поясе пользователя. Записи дневника хранятся в UTC,
// а «сегодня» и «завтрак» — понятия местного времени.

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";
export const MEALS: Meal[] = ["breakfast", "lunch", "snack", "dinner"];
export const MEAL_RU: Record<Meal, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  snack: "Перекус",
  dinner: "Ужин",
};

export const DEFAULT_TZ = "Europe/Moscow";

/** Корректная ли зона IANA (из cookie браузера приходит что угодно). */
export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: string | null | undefined): s is string =>
  !!s && ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Местные дата и час момента времени в зоне tz. */
export function zonedParts(at: Date, tz: string): { date: string; hour: number; minute: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export const todayIn = (tz: string, now = new Date()) => zonedParts(now, tz).date;

/** Смещение зоны от UTC в минутах в момент at (Москва: +180). */
function offsetMinutes(at: Date, tz: string): number {
  const p = zonedParts(at, tz);
  const [y, m, d] = p.date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** Момент UTC для местного времени date hh:mm в зоне tz (с учётом перехода на летнее время). */
export function zonedTime(date: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  // Две итерации достаточно даже на границе перевода часов.
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** Полуинтервал [start, end) местного дня в UTC. */
export function dayRange(date: string, tz: string): { start: Date; end: Date } {
  return { start: zonedTime(date, 0, 0, tz), end: zonedTime(addDays(date, 1), 0, 0, tz) };
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Приём пищи по местному часу. */
export function mealByHour(hour: number): Meal {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 18 && hour < 23) return "dinner";
  return "snack";
}

const MEAL_TIME: Record<Meal, [number, number]> = {
  breakfast: [8, 30],
  lunch: [13, 30],
  snack: [16, 30],
  dinner: [19, 30],
};

/**
 * Когда записать приём пищи: сегодня — «сейчас», в другой день — типичное
 * время этого приёма (порядок записей в прошлых днях остаётся осмысленным).
 */
export function eatenAtFor(date: string, meal: Meal, tz: string, now = new Date()): Date {
  if (date === todayIn(tz, now)) return now;
  const [h, m] = MEAL_TIME[meal];
  return zonedTime(date, h, m, tz);
}

/** «вторник, 29 сентября» / «Сегодня» / «Вчера». */
export function dayTitle(date: string, tz: string, now = new Date()): string {
  const today = todayIn(tz, now);
  if (date === today) return "Сегодня";
  if (date === addDays(today, -1)) return "Вчера";
  if (date === addDays(today, 1)) return "Завтра";
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** Понедельник недели, в которую входит date (недели — с понедельника). */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 — воскресенье
  return addDays(date, -((dow + 6) % 7));
}

export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** «22–28 сентября» / «29 сентября – 5 октября». */
export function weekTitle(monday: string): string {
  const sunday = addDays(monday, 6);
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ru-RU", { ...o, timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  return monday.slice(5, 7) === sunday.slice(5, 7)
    ? `${fmt(monday, { day: "numeric" })}–${fmt(sunday, { day: "numeric", month: "long" })}`
    : `${fmt(monday, { day: "numeric", month: "long" })} – ${fmt(sunday, { day: "numeric", month: "long" })}`;
}
