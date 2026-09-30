// Профиль → «Приёмы пищи»: правки своего списка приёмов (чистые функции).
// Сам список и его проверка — domain/meals.ts (normalizeMealPlanItems, MEAL_PLAN_MAX).
import { mealKey, type MealPlanItem } from "@/domain/meals";

/** Обычный порядок дня: по нему добавленный приём сразу встаёт на своё место. */
const DAY_ORDER = ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин", "Поздний ужин"];
const RANK = new Map(DAY_ORDER.map((name, i) => [mealKey(name), i]));

/** Подсказки под «+ Добавить приём» — в порядке дня; «Перекус» — в любое время дня. */
export const MEAL_SUGGESTIONS = ["Завтрак", "Второй завтрак", "Обед", "Полдник", "Ужин", "Поздний ужин", "Перекус"];

/**
 * Куда вставить новый приём name: «Второй завтрак» — после «Завтрака»,
 * «Полдник» — после «Обеда», «Завтрак» в списке без него — перед первым
 * приёмом дня. Своё название и «Перекус» (у них нет места в дне) — в конец;
 * их потом можно перетащить.
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

/** Подсказки, которых ещё нет в списке (скрытые — тоже в списке). */
export function mealSuggestions(plan: readonly string[]): string[] {
  const have = new Set(plan.map(mealKey));
  return MEAL_SUGGESTIONS.filter((s) => !have.has(mealKey(s)));
}

/**
 * Добавить приём name: такой уже есть, но скрыт — он снова предлагается (а не
 * второй такой же); иначе новый на своё место по порядку дня (insertIndex).
 * make — строка списка из названия (id для React).
 */
export function addMealItem<T extends MealPlanItem>(items: readonly T[], name: string, make: (name: string) => T): T[] {
  const k = mealKey(name);
  if (items.some((i) => i.hidden && mealKey(i.name) === k)) return items.map((i) => (mealKey(i.name) === k ? { ...i, hidden: false } : i));
  const at = insertIndex(
    items.map((i) => i.name),
    name,
  );
  return [...items.slice(0, at), make(name), ...items.slice(at)];
}

/**
 * Скрыть / показать приём i. Скрыто название целиком (как хранится —
 * profiles.meal_plan_hidden): два «Полдника» скрываются вместе. Скрыть
 * последний предлагаемый нельзя — null.
 */
export function toggleHidden<T extends MealPlanItem>(items: readonly T[], i: number): T[] | null {
  const item = items[i];
  if (!item) return null;
  const k = mealKey(item.name);
  const hidden = !item.hidden;
  const next = items.map((it) => (mealKey(it.name) === k ? { ...it, hidden } : it));
  return next.some((it) => !it.hidden) ? next : null;
}

/**
 * Переименовать приём i в name. Скрыто название целиком (как хранит сервер,
 * domain/meals.ts normalizeMealPlanItems): если name в списке уже есть, у всех
 * его строк один признак — предлагается, если предлагалась хоть одна из них
 * (переименованная или прежние), как и «+ Добавить» скрытого названия снова
 * его показывает. Иначе сервер скрыл бы переименованный приём молча (или
 * отказал, не оставив ни одного предлагаемого), а список показывал бы его
 * предлагаемым.
 */
export function renameItem<T extends MealPlanItem>(items: readonly T[], i: number, name: string): T[] {
  const k = mealKey(name);
  const group = (it: T, j: number) => j === i || mealKey(it.name) === k;
  const hidden = items.every((it, j) => !group(it, j) || it.hidden);
  return items.map((it, j) => (j === i ? { ...it, name, hidden } : group(it, j) ? { ...it, hidden } : it));
}

/** Убрать приём i можно, если после этого в списке останется хоть один предлагаемый. */
export function canRemove(items: readonly MealPlanItem[], i: number): boolean {
  return items.length > 1 && items.some((it, j) => j !== i && !it.hidden);
}
