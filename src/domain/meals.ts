// Приёмы пищи. День — упорядоченный список приёмов (day_meals: название и
// позиция), записи принадлежат приёму. Названия любые: «Завтрак, Обед, Ужин,
// Перекус» — только стандартный набор, перекусов может быть сколько угодно.
// Порядок, в который встают новые приёмы, — свой список пользователя в Профиле
// (meal_plan; скрытые в нём названия не предлагаются, но порядок задают);
// «Перекус» бывает в любое время дня — новый встаёт в конец дня. Внутри дня
// приёмы можно переставить. Время приёма вторично: показывается, только если
// включено в Профиле.
// Вид приёма (enum meal) остаётся для ранжирования «Блюд».
import { MEAL_RU, MEAL_TIME, type Meal, mealByHour, zonedParts } from "./day";

/** Готовые названия — стандартный набор приёмов в порядке по умолчанию. */
export const MEAL_PRESETS = ["Завтрак", "Обед", "Ужин", "Перекус"] as const;
export type MealPreset = (typeof MEAL_PRESETS)[number];

/** «Перекус» — в любое время дня: новый встаёт в конец дня, а не по списку. */
export const SNACK: MealPreset = "Перекус";

const PRESET_KIND: Record<MealPreset, Meal> = { "Завтрак": "breakfast", "Обед": "lunch", "Перекус": "snack", "Ужин": "dinner" };

/** Типичное местное время готовых приёмов: 8:30, 13:30, 16:30, 19:30. */
export const PRESET_TIME = Object.fromEntries(MEAL_PRESETS.map((p) => [p, MEAL_TIME[PRESET_KIND[p]]])) as Record<
  MealPreset,
  [number, number]
>;

export const MEAL_NAME_MAX = 40;

/** Список приёмов нового пользователя (profiles.meal_plan по умолчанию): Завтрак, Обед, Ужин, Перекус. */
export const DEFAULT_MEAL_PLAN: string[] = [...MEAL_PRESETS];
export const MEAL_PLAN_MAX = 12;

/**
 * Сегодня запись встаёт в приём, в который что-то добавляли за последние
 * 90 минут (defaultMealTarget, правило 3).
 */
const RECENT_MS = 90 * 60_000;
/** Часы телефона и сервера расходятся: запись «из будущего» до 15 минут — тоже недавняя. */
const SKEW_MS = 15 * 60_000;
/**
 * Сегодня до обычного времени следующего по списку приёма больше двух часов — то,
 * что едят сейчас, скорее перекус: «Ужин» в 15:00 после обеда не предлагаем.
 */
const SNACK_GAP_MIN = 120;

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

const SNACK_KEY = lower(SNACK);

/** «Перекус» ли это (без учёта регистра и пробелов). */
export const isSnack = (name: string) => mealKey(name) === SNACK_KEY;

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

/** Приём своего списка: название и скрыт ли он — не предлагается при добавлении еды. */
export type MealPlanItem = { name: string; hidden: boolean };

/**
 * Свой список с признаком «скрыт» из настроек (PUT /api/profile/meals { items }):
 * названия нормализуются, пустые выбрасываются, повторы можно. Скрыто название
 * целиком (как и хранится — profiles.meal_plan_hidden): повтор скрыт, если скрыто
 * хоть одно его вхождение. 1–12 приёмов и хотя бы один не скрытый, иначе null.
 */
export function normalizeMealPlanItems(input: unknown): MealPlanItem[] | null {
  if (!Array.isArray(input)) return null;
  const raw: MealPlanItem[] = [];
  for (const x of input as unknown[]) {
    if (typeof x !== "object" || x == null) return null;
    const { name, hidden } = x as { name?: unknown; hidden?: unknown };
    if (typeof name !== "string" || (hidden != null && typeof hidden !== "boolean")) return null;
    const n = normalizeMealName(name);
    if (n) raw.push({ name: n, hidden: hidden === true });
  }
  if (raw.length < 1 || raw.length > MEAL_PLAN_MAX) return null;
  const hiddenKeys = new Set(raw.filter((i) => i.hidden).map((i) => mealKey(i.name)));
  const items = raw.map((i) => ({ name: i.name, hidden: hiddenKeys.has(mealKey(i.name)) }));
  return items.some((i) => !i.hidden) ? items : null;
}

/**
 * Свой список из хранения: названия по порядку (meal_plan) и скрытые названия
 * (meal_plan_hidden, сравнение по mealKey). Скрыто всё — показываются все:
 * хоть один приём предлагать нужно.
 */
export function planItems(plan: readonly string[], hidden: readonly string[]): MealPlanItem[] {
  const keys = new Set(hidden.map(mealKey));
  const items = plan.map((name) => ({ name, hidden: keys.has(mealKey(name)) }));
  return items.some((i) => !i.hidden) ? items : items.map((i) => ({ ...i, hidden: false }));
}

/** Названия, которые предлагаются при добавлении еды, — по порядку, без скрытых. */
export const visiblePlan = (items: readonly MealPlanItem[]): string[] => items.filter((i) => !i.hidden).map((i) => i.name);

/** Скрытые названия для хранения (profiles.meal_plan_hidden) — без повторов, в порядке списка. */
export const hiddenNames = (items: readonly MealPlanItem[]): string[] => planNames(items.filter((i) => i.hidden).map((i) => i.name));

/**
 * Названия своего списка без повторов, в его порядке: два «Полдника» в
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
 * k-й приём с названием X — k-е вхождение X в списке. Приёма сверх списка,
 * не из списка и «Перекуса» (он в любое время дня, места в списке у него
 * нет) — undefined.
 */
function planSlots(sorted: readonly { name: string }[], plan: readonly string[]): (number | undefined)[] {
  const slots = new Map<string, number[]>();
  plan.forEach((p, i) => {
    const k = mealKey(p);
    if (k === SNACK_KEY) return;
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
 * Позиция нового приёма name в дне по списку пользователя (весь список, со
 * скрытыми): перед первым приёмом, который в списке стоит дальше (посередине
 * между ним и предыдущим; в начало дня — на единицу меньше первого), иначе в
 * конец. Приёмы не из списка и перекусы остаются на своих местах и в сравнении
 * не участвуют. «Перекус» — всегда в конец дня (перекус бывает в любое время,
 * порядок потом можно поменять перетаскиванием); названия нет в списке (или
 * все его места в дне уже заняты) — тоже в конец.
 */
export function placeNewMeal(dayMeals: readonly Positioned[], name: string, plan: readonly string[]): number {
  const sorted = byPosition(dayMeals);
  if (sorted.length === 0) return 1;
  const end = sorted[sorted.length - 1].position + 1;
  if (isSnack(name)) return end;
  const slots = planSlots([...sorted, { name }], plan);
  const mine = slots[sorted.length];
  if (mine === undefined) return end;
  const next = sorted.findIndex((_, i) => slots[i] !== undefined && slots[i]! > mine);
  if (next < 0) return end;
  if (next === 0) return sorted[0].position - 1;
  return (sorted[next - 1].position + sorted[next].position) / 2;
}

/**
 * Приём дня, в который встанет запись «в приём name» (не новый): последний
 * приём дня с этим названием. «Перекус» — только если он последний в дне:
 * перекус бывает в любое время, и после обеда или ужина это уже новый
 * перекус в конце дня. Нет такого — undefined (нужен новый приём).
 */
export function mealToJoin<T extends Positioned>(dayMeals: readonly T[], name: string): T | undefined {
  const sorted = byPosition(dayMeals);
  if (isSnack(name)) {
    const last = sorted.at(-1);
    return last && isSnack(last.name) ? last : undefined;
  }
  const k = mealKey(name);
  return sorted.findLast((m) => mealKey(m.name) === k);
}

/** Куда добавить запись: в приём дня или в новый приём с этим названием. */
export type MealTarget = { mealId: string } | { name: string };

type TargetMeal = { id: string; name: string; position: number; lastAt: Date | string | null };

/**
 * Приём по умолчанию для новой записи (POST /api/entries без приёма и лист
 * порции на клиенте). plan — названия, которые предлагаются (без скрытых):
 * 1. preferred.mealId — этот приём, если он есть в дне;
 * 2. preferred.name — приём дня с таким названием (из нескольких — последний;
 *    «Перекус» — только последний в дне, mealToJoin), иначе новый;
 * 3. сегодня — приём, в который добавляли за последние 90 минут (последний);
 * 4. в дне есть приёмы из списка — следующий по списку незанятый приём после
 *    последнего занятого («Перекус» так не предлагается: он в любое время дня);
 * 5. из списка в дне ничего (день пустой или только перекусы и свои
 *    названия) — приём списка по часу «сейчас» («Ужин» вечером), если он
 *    есть в списке, иначе первый в списке;
 * 6. иначе: сегодня — название по часу (или уже начатый приём с ним); скрытое
 *    (не из plan) — «Перекус», скрыт и он — последний приём дня; в другой
 *    день — последний приём дня.
 * Новый приём с названием, которое в дне уже есть и все места которого в
 * списке заняты, — не новый: это последний приём с этим названием. Новый
 * «Перекус» встаёт в конец дня (placeNewMeal), а присоединиться можно только
 * к перекусу, который в дне последний.
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
  const joinable = (name: string) => mealToJoin(meals, name);

  // 1–2. Выбор пользователя.
  const byId = preferred?.mealId ? meals.find((m) => m.id === preferred.mealId) : undefined;
  if (byId) return { mealId: byId.id };
  const wanted = normalizeMealName(preferred?.name);
  if (wanted) {
    const hit = joinable(wanted);
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
    const hit = joinable(name);
    // У перекуса мест в списке нет: он присоединяется, только если последний в дне.
    const spare = !isSnack(name) && plan.some((p, i) => mealKey(p) === mealKey(name) && !filled.has(i));
    return hit && !spare ? { mealId: hit.id } : { name };
  };

  const lastSlot = slots.findLast((s) => s !== undefined);
  if (lastSlot !== undefined) {
    // 4. Следующий по списку (перекус — в любое время, его не предлагаем по порядку);
    //    сегодня, если до его обычного времени больше двух часов, — перекус.
    const snackOffered = plan.some(isSnack) || joinable(SNACK) != null;
    const now = nowLocal.hour * 60 + nowLocal.minute;
    const farAhead = (name: string) => {
      const preset = presetOf(name);
      if (!preset) return false; // у своего названия обычного времени нет
      const [h, m] = PRESET_TIME[preset];
      return h * 60 + m - now > SNACK_GAP_MIN;
    };
    for (let j = lastSlot + 1; j < plan.length; j++) {
      if (filled.has(j) || isSnack(plan[j])) continue;
      if (isToday && snackOffered && farAhead(plan[j])) return target(SNACK);
      return target(plan[j]);
    }
  } else if (plan.length > 0) {
    // 5. Из списка в дне ещё ничего — по часу.
    const byHour = mealKey(defaultMealName(nowLocal.hour));
    return target(plan.find((p) => mealKey(p) === byHour) ?? plan[0]);
  }

  // 6. Список в дне пройден.
  const last = meals.at(-1);
  if (isToday || !last) {
    // Скрытое название (его нет среди предлагаемых) по часу не предлагаем, пока
    // такого приёма в дне нет: вместо него «Перекус» (он в любое время дня),
    // скрыт и он — последний приём дня. Без списка предлагается всё.
    const byHour = defaultMealName(nowLocal.hour);
    const offered = (name: string) => plan.length === 0 || plan.some((p) => mealKey(p) === mealKey(name));
    const name = [byHour, SNACK].find((n) => joinable(n) || offered(n));
    if (name) {
      const hit = joinable(name);
      return hit ? { mealId: hit.id } : { name };
    }
    if (!last) return { name: byHour };
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
