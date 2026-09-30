// Приёмы пищи. День — упорядоченный список приёмов (day_meals: название и
// позиция), записи принадлежат приёму. Названия любые: «Завтрак, Обед, Перекус,
// Ужин» — только подсказки, перекусов может быть сколько угодно. Порядок, в
// который встают новые приёмы, — свой список пользователя в Профиле (meal_plan);
// внутри дня приём можно передвинуть. Время приёма вторично: показывается,
// только если включено в Профиле.
// Вид приёма (enum meal) остаётся для ранжирования «Моих блюд».
import { MEAL_RU, MEAL_TIME, type Meal, mealByHour, zonedParts } from "./day";

/** Готовые названия — в порядке дня. */
export const MEAL_PRESETS = ["Завтрак", "Обед", "Перекус", "Ужин"] as const;
export type MealPreset = (typeof MEAL_PRESETS)[number];

const PRESET_KIND: Record<MealPreset, Meal> = { "Завтрак": "breakfast", "Обед": "lunch", "Перекус": "snack", "Ужин": "dinner" };

/** Типичное местное время готовых приёмов: 8:30, 13:30, 16:30, 19:30. */
export const PRESET_TIME = Object.fromEntries(MEAL_PRESETS.map((p) => [p, MEAL_TIME[PRESET_KIND[p]]])) as Record<
  MealPreset,
  [number, number]
>;

export const MEAL_NAME_MAX = 40;

/** Список приёмов нового пользователя (profiles.meal_plan по умолчанию). */
export const DEFAULT_MEAL_PLAN: string[] = [...MEAL_PRESETS];
export const MEAL_PLAN_MAX = 12;

/**
 * Сегодня запись встаёт в приём, в который что-то добавляли за последние
 * 90 минут (defaultMealTarget, правило 3).
 */
const RECENT_MS = 90 * 60_000;
/** Часы телефона и сервера расходятся: запись «из будущего» до 15 минут — тоже недавняя. */
const SKEW_MS = 15 * 60_000;

const lower = (s: string) => s.toLocaleLowerCase("ru");

/**
 * Название приёма как его хранить: без лишних пробелов, не длиннее 40 знаков,
 * с заглавной буквы; готовые названия — в каноническом написании
 * («ЗАВТРАК» → «Завтрак»). Пустое → null.
 */
export function normalizeMealName(s: string | null | undefined): string | null {
  // Управляющие символы — тоже пробелы: \0 Postgres в text не примет.
  const cleaned = (s ?? "").replace(/[\s\p{Cc}]+/gu, " ").trim();
  // По кодовым точкам, а не UTF-16: эмодзи на границе не разрежется пополам.
  const chars = Array.from(cleaned).slice(0, MEAL_NAME_MAX);
  const cut = chars.join("").trimEnd();
  // Только невидимые знаки (U+200B, метки направления) — тоже пустое название.
  if (!/[^\s\p{Cc}\p{Cf}]/u.test(cut)) return null;
  const name = chars[0].toLocaleUpperCase("ru") + cut.slice(chars[0].length);
  return MEAL_PRESETS.find((p) => lower(p) === lower(name)) ?? name;
}

/**
 * Поле названия приёма на клиенте: не длиннее 40 кодовых точек — как считает
 * normalizeMealName. maxLength у поля считает единицы UTF-16, и эмодзи (две
 * единицы) расходовали бы лимит вдвое быстрее, чем на сервере. Режет по кодовым
 * точкам, а не по графемам: составной эмодзи (ZWJ-последовательность, флаг,
 * оттенок кожи) на границе может потерять хвост — остаются целые символы, как
 * и после normalizeMealName.
 */
export function clampMealName(s: string): string {
  const chars = Array.from(s);
  return chars.length > MEAL_NAME_MAX ? chars.slice(0, MEAL_NAME_MAX).join("") : s;
}

/** Ключ сравнения названий: регистр и пробелы не важны. */
export const mealKey = (name: string) => lower(normalizeMealName(name) ?? "");

/** Готовое ли это название (без учёта регистра) — и какое. */
export function presetOf(name: string | null | undefined): MealPreset | null {
  const n = normalizeMealName(name);
  return n && (MEAL_PRESETS as readonly string[]).includes(n) ? (n as MealPreset) : null;
}

/** Вид приёма: у готового названия — свой, у любого другого — по местному часу. */
export function mealKindOf(name: string, localHour: number): Meal {
  const preset = presetOf(name);
  return preset ? PRESET_KIND[preset] : mealByHour(localHour);
}

/** Название по умолчанию для местного часа: 9 → «Завтрак», 17 → «Перекус». */
export const defaultMealName = (localHour: number): string => MEAL_RU[mealByHour(localHour)];

/** «HH:MM» или «H:MM» → часы и минуты; иначе null. */
export function parseTime(s: string | null | undefined): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s?.trim() ?? "");
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}
export const isTime = (s: string) => parseTime(s) != null;

/** Местное «HH:MM». */
export function formatTime(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

// ─── Свой список приёмов (Профиль) ───

/**
 * Список приёмов из настроек: названия нормализуются, пустые выбрасываются,
 * повторы разрешены (два «Перекуса» — два места в дне). Не массив строк,
 * пустой или длиннее 12 — null.
 */
export function normalizeMealPlan(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.some((x) => typeof x !== "string")) return null;
  const plan = (input as string[]).map(normalizeMealName).filter((n): n is string => n != null);
  return plan.length >= 1 && plan.length <= MEAL_PLAN_MAX ? plan : null;
}

/**
 * Названия своего списка без повторов, в его порядке: два «Перекуса» в
 * списке — одна кнопка. Кнопки нового приёма (ui/MealPicker), переименования
 * приёма и пустого дня.
 */
export function planNames(plan: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of plan) {
    const k = mealKey(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

// ─── Порядок приёмов в дне ───

type Positioned = { name: string; position: number };

/** По позиции; при равных — как пришли. */
const byPosition = <T extends Positioned>(meals: readonly T[]): T[] =>
  meals
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.position - b.m.position || a.i - b.i)
    .map((x) => x.m);

/**
 * Место каждого приёма дня (в порядке позиций) в списке пользователя:
 * k-й приём с названием X — k-е вхождение X в списке. Приёма сверх списка
 * или не из списка — undefined.
 */
function planSlots(sorted: readonly { name: string }[], plan: readonly string[]): (number | undefined)[] {
  const slots = new Map<string, number[]>();
  plan.forEach((p, i) => {
    const k = mealKey(p);
    slots.set(k, [...(slots.get(k) ?? []), i]);
  });
  const seen = new Map<string, number>();
  return sorted.map((m) => {
    const k = mealKey(m.name);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return slots.get(k)?.[n];
  });
}

/**
 * Позиция нового приёма name в дне по списку пользователя: перед первым
 * приёмом, который в списке стоит дальше (посередине между ним и предыдущим;
 * в начало дня — на единицу меньше первого), иначе в конец. Приёмы не из
 * списка остаются на своих местах и в сравнении не участвуют. Названия нет
 * в списке (или все его места в дне уже заняты) — в конец.
 */
export function placeNewMeal(dayMeals: readonly Positioned[], name: string, plan: readonly string[]): number {
  const sorted = byPosition(dayMeals);
  if (sorted.length === 0) return 1;
  const end = sorted[sorted.length - 1].position + 1;
  const slots = planSlots([...sorted, { name }], plan);
  const mine = slots[sorted.length];
  if (mine === undefined) return end;
  const next = sorted.findIndex((_, i) => slots[i] !== undefined && slots[i]! > mine);
  if (next < 0) return end;
  if (next === 0) return sorted[0].position - 1;
  return (sorted[next - 1].position + sorted[next].position) / 2;
}

/** Куда добавить запись: в приём дня или в новый приём с этим названием. */
export type MealTarget = { mealId: string } | { name: string };

type TargetMeal = { id: string; name: string; position: number; lastAt: Date | string | null };

/**
 * Приём по умолчанию для новой записи (POST /api/entries без приёма и лист
 * порции на клиенте):
 * 1. preferred.mealId — этот приём, если он есть в дне;
 * 2. preferred.name — приём дня с таким названием (из нескольких — последний),
 *    иначе новый;
 * 3. сегодня — приём, в который добавляли за последние 90 минут (последний);
 * 4. в дне есть приёмы — следующий по списку пользователя незанятый приём
 *    после последнего занятого;
 * 5. день пустой — приём списка по часу «сейчас» («Ужин» вечером), если он
 *    есть в списке, иначе первый в списке;
 * 6. иначе: сегодня — название по часу (или уже начатый приём с ним),
 *    в другой день — последний приём дня.
 * Новый приём с названием, которое в дне уже есть и все места которого в
 * списке заняты, — не новый: это последний приём с этим названием.
 */
export function defaultMealTarget(opts: {
  dayMeals: readonly TargetMeal[];
  plan: readonly string[];
  isToday: boolean;
  now: Date;
  nowLocal: { hour: number; minute: number };
  preferred?: { mealId?: string | null; name?: string | null } | null;
}): MealTarget {
  const { plan, isToday, now, nowLocal, preferred } = opts;
  const meals = byPosition(opts.dayMeals);
  const lastNamed = (name: string) => meals.findLast((m) => mealKey(m.name) === mealKey(name));

  // 1–2. Выбор пользователя.
  const byId = preferred?.mealId ? meals.find((m) => m.id === preferred.mealId) : undefined;
  if (byId) return { mealId: byId.id };
  const wanted = normalizeMealName(preferred?.name);
  if (wanted) {
    const hit = lastNamed(wanted);
    return hit ? { mealId: hit.id } : { name: wanted };
  }

  // 3. Сегодня — приём, который сейчас идёт.
  if (isToday) {
    const t = now.getTime();
    let recent: TargetMeal | undefined;
    let recentAt = -Infinity;
    for (const m of meals) {
      if (m.lastAt == null) continue;
      const at = new Date(m.lastAt).getTime();
      if (at >= t - RECENT_MS && at <= t + SKEW_MS && at >= recentAt) {
        recent = m;
        recentAt = at;
      }
    }
    if (recent) return { mealId: recent.id };
  }

  const slots = planSlots(meals, plan);
  const filled = new Set(slots.filter((s) => s !== undefined));
  const target = (name: string): MealTarget => {
    const hit = lastNamed(name);
    const spare = plan.some((p, i) => mealKey(p) === mealKey(name) && !filled.has(i));
    return hit && !spare ? { mealId: hit.id } : { name };
  };

  const lastSlot = slots.findLast((s) => s !== undefined);
  if (lastSlot !== undefined) {
    // 4. Следующий по списку.
    for (let j = lastSlot + 1; j < plan.length; j++) if (!filled.has(j)) return target(plan[j]);
  } else if (plan.length > 0) {
    // 5. Из списка в дне ещё ничего — по часу.
    const byHour = mealKey(defaultMealName(nowLocal.hour));
    return target(plan.find((p) => mealKey(p) === byHour) ?? plan[0]);
  }

  // 6. Список в дне пройден.
  const last = meals.at(-1);
  if (isToday || !last) {
    const name = defaultMealName(nowLocal.hour);
    const hit = lastNamed(name);
    return hit ? { mealId: hit.id } : { name };
  }
  return { mealId: last.id };
}

/**
 * Подписи приёмов дня (в порядке позиций): одинаковые названия нумеруются —
 * «Перекус», «Перекус · 2»; единственный в дне — без номера.
 */
export function mealLabels(meals: readonly { name: string }[]): string[] {
  const total = new Map<string, number>();
  for (const m of meals) total.set(mealKey(m.name), (total.get(mealKey(m.name)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return meals.map((m) => {
    const k = mealKey(m.name);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n > 1 && total.get(k)! > 1 ? `${m.name} · ${n}` : m.name;
  });
}
