// Профиль → «Приёмы пищи»: правки своего списка приёмов (чистые функции).
// Сам список и его проверка — domain/meals.ts (normalizeMealPlan, MEAL_PLAN_MAX).
import { mealKey } from "@/domain/meals";

/** Обычный порядок дня: по нему добавленный приём сразу встаёт на своё место. */
const DAY_ORDER = ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин", "Поздний ужин"];
const RANK = new Map(DAY_ORDER.map((name, i) => [mealKey(name), i]));

/** Подсказки под «+ Добавить приём» — в порядке дня; «Перекус» — в любое время дня. */
export const MEAL_SUGGESTIONS = ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Перекус", "Ужин", "Поздний ужин"];

/**
 * Куда вставить новый приём name: «Второй завтрак» — после «Завтрака»,
 * «Полдник» — после «Обеда», «Завтрак» в списке без него — перед первым
 * приёмом дня. Своё название и «Перекус» (у них нет места в дне) — в конец;
 * их потом можно передвинуть стрелками.
 */
export function insertIndex(plan: readonly string[], name: string): number {
  const rank = RANK.get(mealKey(name));
  if (rank === undefined) return plan.length;
  const ranks = plan.map((p) => RANK.get(mealKey(p)));
  const after = ranks.findLastIndex((r) => r !== undefined && r <= rank);
  if (after >= 0) return after + 1;
  const before = ranks.findIndex((r) => r !== undefined);
  return before >= 0 ? before : plan.length;
}

/**
 * Подсказки, которых ещё нет в списке. «Перекус» — всегда: перекусов в день
 * бывает несколько.
 */
export function mealSuggestions(plan: readonly string[]): string[] {
  const have = new Set(plan.map(mealKey));
  return MEAL_SUGGESTIONS.filter((s) => s === "Перекус" || !have.has(mealKey(s)));
}

/** Список с элементом i, переставленным на место соседа (dir −1 — выше, +1 — ниже); на краю — как был. */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
