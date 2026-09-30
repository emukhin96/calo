// Выбор приёма пищи в листе порции (ui/MealPicker): кнопки выбора, какой приём
// предложить по умолчанию и что из выбора отправить в POST / PATCH /api/entries.
// Кнопки — стандартный набор из своего списка в Профиле (без скрытых, по его
// порядку): «Завтрак · Обед · Ужин · Перекус», затем приёмы дня не из списка и
// «свой…». Название, которое в дне уже есть, — в этот приём; нет — новый приём,
// он встаёт на место по списку (domain/meals.ts placeNewMeal), «Перекус» — в
// конец дня. Время приёма вторично: показывается и задаётся, только если это
// включено в Профиле.
// Чистая логика без React — годится и для клиента, и для тестов (./meal-choice.test.ts).
import { MEAL_TIME } from "@/domain/day";
import {
  defaultMealName,
  defaultMealTarget,
  mealKey,
  mealKindOf,
  mealLabels,
  mealToJoin,
  normalizeMealName,
  parseTime,
  placeNewMeal,
  planNames,
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
 * следующий по списку пользователя → по часу. plan — названия, которые
 * предлагаются (без скрытых). Новый приём — без времени.
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
 * Кнопка выбора приёма (ui/MealPicker):
 * - plan — название из своего списка (без скрытых): запись встанет в приём дня
 *   с этим названием (join; «Перекус» — только если он в дне последний,
 *   domain/meals.ts mealToJoin), а такого нет — в новый приём;
 * - meal — этот приём дня: не из списка («Кофе», скрытый «Полдник») или
 *   выбранный заранее («+» у приёма, правка записи), которого кнопка названия
 *   не выберет («Перекус · 1» — первый из двух).
 * key — для React и выбора (chosenChip).
 */
export type MealChip =
  | { kind: "plan"; key: string; label: string; name: string; join: DayMeal | null }
  | { kind: "meal"; key: string; label: string; meal: DayMeal };

/**
 * Кнопки выбора приёма: названия своего списка по его порядку (повторы в
 * списке — одна кнопка), затем приёмы дня не из списка — по порядку дня, с
 * подписью дня («Кофе · 2», с показом времени — «Кофе 16:30»). keep — приёмы
 * дня, выбранные заранее: если кнопка названия их не выберет (первый из двух
 * «Перекусов», «Перекус» не последним в дне), у них своя кнопка среди приёмов
 * дня — «Перекус · 1».
 */
export function mealChips(
  meals: readonly DayMeal[],
  plan: readonly string[],
  keep: readonly (string | null | undefined)[] = [],
): MealChip[] {
  const names = planNames(plan);
  const day = positioned(meals);
  const chips: MealChip[] = names.map((name) => {
    const hit = mealToJoin(day, name);
    return { kind: "plan", key: `plan:${mealKey(name)}`, label: name, name, join: meals.find((m) => m.id === hit?.id) ?? null };
  });
  const inPlan = new Set(names.map(mealKey));
  const joined = new Set(chips.map((c) => (c.kind === "plan" ? c.join?.id : undefined)));
  const seen = new Map<string, number>();
  for (const m of meals) {
    const k = mealKey(m.name);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (!inPlan.has(k)) chips.push({ kind: "meal", key: `meal:${m.id}`, label: m.label, meal: m });
    else if (keep.includes(m.id) && !joined.has(m.id))
      // Подпись без номера и времени совпала бы с кнопкой названия — с номером.
      chips.push({ kind: "meal", key: `meal:${m.id}`, label: m.label !== m.name ? m.label : `${m.name} · ${n}`, meal: m });
  }
  return chips;
}

/**
 * Какая кнопка выбрана: начатый приём — кнопка, которая в него добавит; новый —
 * кнопка его названия из списка (своё название — ни одна, оно в поле «свой…»).
 */
export function chosenChip(chips: readonly MealChip[], value: MealChoice): string | null {
  if (value.kind === "existing") {
    const hit = chips.find((c) => (c.kind === "plan" ? c.join?.id : c.meal.id) === value.mealId);
    return hit?.key ?? null;
  }
  const k = mealKey(value.name);
  return (k && chips.find((c) => c.kind === "plan" && mealKey(c.name) === k)?.key) || null;
}

/**
 * Выбор по нажатию кнопки: в приём дня (join или приём кнопки) или новый
 * приём с этим названием — с временем, выставленным вручную (null — решит
 * сервер). Новый «Перекус», когда перекус в дне уже есть, но не последний, —
 * again: сервер заведёт ещё один в конце дня.
 */
export function chipChoice(chip: MealChip, meals: readonly { name: string }[], time: string | null = null): MealChoice {
  const m = chip.kind === "meal" ? chip.meal : chip.join;
  if (m) return { kind: "existing", mealId: m.id, name: m.name };
  return newMealChoice(meals, chip.label, time);
}

/**
 * Куда в дне встанет новый приём name — индекс вставки в meals (0 — первым,
 * meals.length — последним). Та же раскладка, что у сервера (placeNewMeal):
 * order — весь свой список, со скрытыми (они тоже задают порядок); «Перекус» —
 * в конец дня.
 */
export function newMealIndex(meals: readonly { name: string }[], name: string, order: readonly string[]): number {
  const list = meals.map((m, i) => ({ name: m.name, position: i + 1 }));
  const at = placeNewMeal(list, normalizeMealName(name) ?? name, order);
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
