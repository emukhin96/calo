// Экран «Добавить»: разбор ссылки (/add?d=…&meal=…&text=…&tab=…), подпись
// приёма из ссылки и поля приёма для нескольких записей подряд (разбор текста).
// Чистая логика без React — страница (сервер), вкладки (клиент) и тесты
// (./add-flow.test.ts). Выбор приёма по умолчанию — lib/meal-choice.ts.
import { MEAL_RU, MEALS, type Meal } from "@/domain/day";
import { mealKey, mealLabels, normalizeMealName } from "@/domain/meals";
import { type MealChoice, mealChoiceBody } from "@/lib/meal-choice";

export type AddTab = "food" | "text" | "recipes";
const TABS: AddTab[] = ["food", "text", "recipes"];

/**
 * Приём из ссылки «добавить в этот приём»: приём дня по id (кнопка «+» у
 * приёма в дневнике) или по названию (пустой день, старые ссылки).
 */
export type PreferredMeal = { mealId: string } | { name: string };

/** Столько же принимает /api/parse/text. */
export const TEXT_MAX = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * ?meal= — id приёма дня, название приёма («Перекус», «Второй завтрак») или
 * старое значение вида из прежних ссылок (lunch → «Обед»). Прежний ?t= (время
 * приёма) больше не нужен: приём — это id или название, а не время.
 */
export function preferredMealOf(meal: unknown): PreferredMeal | null {
  const raw = one(meal)?.trim() ?? null;
  if (raw && UUID.test(raw)) return { mealId: raw.toLowerCase() };
  const name = normalizeMealName(raw && (MEALS as string[]).includes(raw) ? MEAL_RU[raw as Meal] : raw);
  return name ? { name } : null;
}

/** Ключ приёма из ссылки — для key вкладок: другой приём — выбор заново. */
export const preferredKey = (p: PreferredMeal | null): string => (p == null ? "" : "mealId" in p ? p.mealId : p.name);

/**
 * Подпись приёма из ссылки под заголовком: приём дня — как в дневнике
 * («Перекус · 2»), время — только если показ времени включён в Профиле;
 * название, которого в дне ещё нет, — как есть (запись начнёт новый приём).
 * Приёма с таким id в дне нет (удалили) — null: выбор по умолчанию.
 * meals — приёмы дня по порядку (loadDay().meals).
 */
export function preferredMealTitle(
  meals: readonly { id: string; name: string; time: string | null }[],
  preferred: PreferredMeal | null,
  showTimes: boolean,
): { label: string; time: string | null } | null {
  if (!preferred) return null;
  const labels = mealLabels(meals);
  const i =
    "mealId" in preferred
      ? meals.findIndex((m) => m.id === preferred.mealId)
      : meals.findLastIndex((m) => mealKey(m.name) === mealKey(preferred.name));
  if (i >= 0) return { label: labels[i], time: showTimes ? meals[i].time : null };
  return "name" in preferred ? { label: preferred.name, time: null } : null;
}

/** ?text= — текст из строки ввода дневника: без пробелов по краям, не длиннее TEXT_MAX; пустой — null. */
export function initialTextOf(text: unknown): string | null {
  const s = one(text)?.trim().slice(0, TEXT_MAX).trim();
  return s ? s : null;
}

/** Вкладка: с текстом из дневника — «Текст», иначе ?tab=, иначе «Продукт». */
export function addTabOf(tab: unknown, text: string | null): AddTab {
  if (text) return "text";
  const t = one(tab);
  return TABS.includes(t as AddTab) ? (t as AddTab) : "food";
}

/**
 * Название выбранного приёма — для «Моих блюд»: вероятные для него сверху.
 * Приём дня — его название; новый — нормализованное; не нашёлся или пустое — null.
 */
export function choiceMealName(choice: MealChoice, meals: readonly { id: string; name: string }[]): string | null {
  if (choice.kind === "existing") return meals.find((m) => m.id === choice.mealId)?.name ?? null;
  return normalizeMealName(choice.name);
}

/**
 * Приём, в который встала первая отправленная позиция разбора текста:
 * id из ответа сервера; null — id неизвестен (ушла в офлайн-очередь);
 * undefined — ещё ничего не отправлено.
 */
export type FirstMeal = string | null | undefined;

/**
 * Поля приёма для каждой позиции разбора текста — все в один приём. Начатый
 * приём — { mealId }. Новый создаёт только первая позиция ({ mealName,
 * newMeal: true }), остальные идут в него по id из её ответа; время, если его
 * выставили, — у всех одно. Первая ушла в очередь — остальные по названию без
 * newMeal: сервер положит их в последний приём дня с этим названием, то есть
 * в созданный первой (иначе каждая позиция начала бы свой приём).
 */
export function rowMealBody(
  choice: MealChoice,
  first: FirstMeal,
): { mealId: string; mealName?: string; time?: string } | { mealName: string; newMeal?: true; time?: string } {
  const body = mealChoiceBody(choice);
  // Начатый приём или первая позиция нового — как есть.
  if (first === undefined || "mealId" in body) return body;
  const time = body.time ? { time: body.time } : {};
  // По id — с названием: если приём удалят, пока позиции ждут в очереди, сервер найдёт его по названию.
  return first ? { mealId: first, mealName: body.mealName, ...time } : { mealName: body.mealName, ...time };
}
