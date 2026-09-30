// Выбор приёма пищи в листе порции (ui/MealPicker): какой приём предложить
// по умолчанию и что из выбора отправить в POST / PATCH /api/entries.
// День — упорядоченный список приёмов (day_meals); новый приём встаёт на место
// по списку пользователя из Профиля (domain/meals.ts placeNewMeal). Время приёма
// вторично: показывается и задаётся, только если это включено в Профиле.
// Чистая логика без React — годится и для клиента, и для тестов (./meal-choice.test.ts).
import { MEAL_TIME } from "@/domain/day";
import {
  defaultMealName,
  defaultMealTarget,
  mealKey,
  mealKindOf,
  mealLabels,
  normalizeMealName,
  parseTime,
  placeNewMeal,
  PRESET_TIME,
  presetOf,
} from "@/domain/meals";

/**
 * Приём пищи дня для выбора — в порядке дня. label — подпись кнопки: одинаковые
 * названия нумеруются («Перекус», «Перекус · 2»), с показом времени — «Перекус 16:30».
 * time — местное «HH:MM» первой записи, lastAt — ISO последней (приём «сейчас идёт»).
 */
export type DayMeal = { id: string; name: string; label: string; time: string | null; kcal: number; lastAt: string | null };

/**
 * Выбранный приём: уже начатый приём дня или новый с названием. time нового —
 * «HH:MM», только если его выставили (показ времени включён в Профиле); null —
 * время решит сервер: сегодня — «сейчас», в другой день — типичное время приёма.
 * again — в дне (каким его видит экран) уже есть приём с этим названием, и нужен
 * именно ещё один: сервер заведёт новый (newMeal). false — такого в дне нет:
 * запись из устаревшего дня (офлайн-очередь, лист, открытый до обновления) встанет
 * в приём с этим названием, если он тем временем появился, а не заведёт второй
 * такой же. Не указан — как true (newMealChoice ставит его всегда).
 */
export type MealChoice =
  /** name — название приёма: запасной путь, если приём удалят, пока запись ждёт в офлайн-очереди. */
  | { kind: "existing"; mealId: string; name?: string }
  | { kind: "new"; name: string; time: string | null; again?: boolean };
export type NewMealChoice = Extract<MealChoice, { kind: "new" }>;

/** Новый приём name в дне meals — с again по тому, есть ли в дне приём с этим названием. */
export function newMealChoice(meals: readonly { name: string }[], name: string, time: string | null = null): NewMealChoice {
  const k = mealKey(name);
  return { kind: "new", name, time, again: k !== "" && meals.some((m) => mealKey(m.name) === k) };
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;

/** «08:30» → «8:30» — так время приёма показываем на кнопках. */
export function shortTime(time: string): string {
  const t = parseTime(time);
  return t ? `${t.hour}:${pad(t.minute)}` : time;
}

/** Местное «HH:MM» по часам телефона. */
export function nowTime(now: Date = new Date()): string {
  return hhmm(now.getHours(), now.getMinutes());
}

/** Местная дата телефона «YYYY-MM-DD» — сравнить с днём дневника (isToday). */
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Местные часы и минуты телефона. */
export function localClock(now: Date = new Date()): { hour: number; minute: number } {
  return { hour: now.getHours(), minute: now.getMinutes() };
}

/**
 * Приёмы дня с сервера (loadDay / GET /api/entries: DayMealView, по порядку) →
 * кнопки выбора. showTimes — показ времени приёмов включён в Профиле: к подписи
 * добавляется время начала, а номер повтора остаётся, только если и время у
 * одинаковых приёмов совпало.
 */
export function toDayMeals(
  meals: readonly {
    id: string;
    name: string;
    time: string | null;
    lastAt: Date | string | null;
    totals: { kcal?: number | null };
  }[],
  showTimes: boolean,
): DayMeal[] {
  const labels = mealLabels(meals);
  return meals.map((m, i) => {
    const time = parseTime(m.time) ? m.time : null;
    let label = labels[i];
    if (showTimes && time) {
      const twin = meals.some((o, j) => j !== i && mealKey(o.name) === mealKey(m.name) && o.time === time);
      label = `${twin ? labels[i] : m.name} ${shortTime(time)}`;
    }
    return {
      id: m.id,
      name: m.name,
      label,
      time,
      kcal: m.totals.kcal ?? 0,
      lastAt: m.lastAt == null ? null : new Date(m.lastAt).toISOString(),
    };
  });
}

/** Приёмы дня для domain/meals.ts: позиция — порядок в списке. */
const positioned = (meals: readonly DayMeal[]) => meals.map((m, i) => ({ id: m.id, name: m.name, position: i + 1, lastAt: m.lastAt }));

/**
 * Приём по умолчанию в листе порции — то же правило, что у сервера без приёма
 * (domain/meals.ts defaultMealTarget): выбранный в ссылке приём (по id или
 * названию) → сегодня — приём, в который добавляли за последние 90 минут →
 * следующий по списку пользователя → по часу. Новый приём — без времени.
 */
export function defaultMealChoice(opts: {
  meals: readonly DayMeal[];
  plan: readonly string[];
  isToday: boolean;
  now?: Date;
  preferred?: { mealId?: string | null; name?: string | null } | null;
}): MealChoice {
  const now = opts.now ?? new Date();
  const target = defaultMealTarget({
    dayMeals: positioned(opts.meals),
    plan: opts.plan,
    isToday: opts.isToday,
    now,
    nowLocal: localClock(now),
    preferred: opts.preferred,
  });
  if (!("mealId" in target)) return newMealChoice(opts.meals, target.name);
  const name = opts.meals.find((m) => m.id === target.mealId)?.name;
  return { kind: "existing", mealId: target.mealId, ...(name ? { name } : {}) };
}

/**
 * Название, которое предложить для «+ новый»: следующий по списку пользователя
 * незанятый приём дня; после последнего занятого мест нет — незанятое место
 * раньше (забытый завтрак; по часу, если и оно свободно), а не второй такой же
 * приём; список заполнен целиком — по часу «сейчас» (ещё один приём).
 */
export function newMealName(opts: { meals: readonly DayMeal[]; plan: readonly string[]; now?: Date }): string {
  const now = opts.now ?? new Date();
  // Как в другой день: без «недавнего» приёма — нужен именно новый.
  const target = defaultMealTarget({ dayMeals: positioned(opts.meals), plan: opts.plan, isToday: false, now, nowLocal: localClock(now) });
  if ("name" in target) return target.name;
  // k-е вхождение названия в списке занято, если в дне больше k приёмов с ним (как в placeNewMeal).
  const inDay = new Map<string, number>();
  for (const m of opts.meals) inDay.set(mealKey(m.name), (inDay.get(mealKey(m.name)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const free = opts.plan.filter((p) => {
    const k = mealKey(p);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return (inDay.get(k) ?? 0) <= n;
  });
  const byHour = defaultMealName(now.getHours());
  return free.find((p) => mealKey(p) === mealKey(byHour)) ?? free[0] ?? byHour;
}

/**
 * Куда в дне встанет новый приём name — индекс вставки в meals (0 — первым,
 * meals.length — последним). Та же раскладка, что у сервера (placeNewMeal).
 */
export function newMealIndex(meals: readonly { name: string }[], name: string, plan: readonly string[]): number {
  const list = meals.map((m, i) => ({ name: m.name, position: i + 1 }));
  const at = placeNewMeal(list, normalizeMealName(name) ?? name, plan);
  return list.filter((m) => m.position < at).length;
}

/**
 * Время, которое сервер поставит новому приёму в прошлый день без явного
 * времени: типичное время готового приёма («Ужин» — 19:30), своего названия —
 * по виду в полдень (13:30). В листе — подсказка в поле времени.
 */
export function typicalMealTime(name: string): string {
  const n = normalizeMealName(name);
  const preset = presetOf(n);
  const [h, m] = preset ? PRESET_TIME[preset] : MEAL_TIME[mealKindOf(n ?? "", 12)];
  return hhmm(h, m);
}

/**
 * Время нового приёма, которое показать в поле (defaultNewTime MealPicker):
 * сегодня — «сейчас»; в другой день — undefined: поле покажет типичное время
 * выбранного названия (typicalMealTime), как и решит сервер.
 */
export function newMealTime(isToday: boolean, now: Date = new Date()): string | undefined {
  return isToday ? nowTime(now) : undefined;
}

/** Выбор можно отправлять: приём дня выбран или у нового есть название (пустое «свой…» — нельзя). */
export function isMealChoiceValid(c: MealChoice): boolean {
  return c.kind === "existing" ? c.mealId !== "" : normalizeMealName(c.name) != null;
}

/**
 * Поля приёма для POST /api/entries и PATCH /api/entries/:id: начатый приём —
 * { mealId } и его название (если приём удалят, пока запись ждёт в офлайн-очереди,
 * сервер положит её в приём с этим названием); новый — { mealName } (+ newMeal: true, если такой приём в дне уже
 * есть и нужен ещё один — again) и «HH:MM», если время выставили. Пустое
 * название — по часу времени (или «сейчас»).
 */
export function mealChoiceBody(
  c: MealChoice,
): { mealId: string; mealName?: string } | { mealName: string; newMeal?: true; time?: string } {
  if (c.kind === "existing") return c.name ? { mealId: c.mealId, mealName: c.name } : { mealId: c.mealId };
  const at = parseTime(c.time);
  const mealName = normalizeMealName(c.name) ?? defaultMealName(at?.hour ?? new Date().getHours());
  const body: { mealName: string; newMeal?: true; time?: string } = c.again === false ? { mealName } : { mealName, newMeal: true };
  if (at) body.time = hhmm(at.hour, at.minute);
  return body;
}
