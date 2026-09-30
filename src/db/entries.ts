// Записи дневника. Нутриенты записи — снимок, посчитанный здесь, на сервере,
// из справочника: клиент присылает только продукт и граммы. Каждая запись
// принадлежит приёму пищи дня (day_meals, ./meals.ts); местный день записи —
// день её приёма.
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { DEFAULT_TZ, MEAL_RU, MEAL_TIME, type Meal, todayIn, zonedParts, zonedTime } from "@/domain/day";
import { formatTime, mealKey, mealKindOf, normalizeMealName, parseTime, PRESET_TIME, presetOf } from "@/domain/meals";
import { type NutrientVector, per100gOf, scale, sum } from "@/domain/nutrients";
import type { DB } from ".";
import { BadRequestError, NotFoundError } from "./errors";
import {
  type Conn,
  type DayMeal,
  defaultDayMeal,
  dropIfEmpty,
  getDayMeal,
  listDayMeals,
  lockMeals,
  mealByName,
  mealPlanOf,
  mealTimes,
} from "./meals";
import { dayMeals, entries, foods, recipes } from "./schema";

export { BadRequestError, NotFoundError } from "./errors";

export type Entry = {
  id: string;
  eatenAt: Date;
  /** Вид приёма (для ранжирования блюд). */
  meal: Meal;
  /** Приём пищи дня (day_meals). */
  mealId: string;
  /** Название приёма пищи: «Завтрак», «Перекус», «Второй завтрак»… */
  mealName: string;
  title: string;
  grams: number;
  foodId: string | null;
  recipeId: string | null;
  nutrients: NutrientVector;
};

/** Приём пищи на экране дня: записи и итоги, по порядку приёмов. */
export type DayMealView = {
  id: string;
  name: string;
  position: number;
  /** Местное «HH:MM» первой записи; у пустого приёма — null. */
  time: string | null;
  /** Время последней записи — «приём сейчас идёт» (domain/meals.ts defaultMealTarget). */
  lastAt: Date | null;
  /** По времени, затем по порядку добавления. */
  entries: Entry[];
  totals: NutrientVector;
};

/** День дневника: все записи (по времени), итоги и приёмы по порядку. */
export type DayData = { date: string; entries: Entry[]; totals: NutrientVector; meals: DayMealView[] };

const columns = {
  id: entries.id,
  eatenAt: entries.eatenAt,
  meal: entries.meal,
  mealId: entries.mealId,
  mealName: dayMeals.name,
  title: entries.title,
  grams: entries.grams,
  foodId: entries.foodId,
  recipeId: entries.recipeId,
  nutrients: entries.nutrients,
};

/** Записи с названием приёма — для выборок ниже. */
const selectEntries = (c: Conn) => c.select(columns).from(entries).innerJoin(dayMeals, eq(dayMeals.id, entries.mealId));

/** Записи местных дней from…to включительно (по дню приёма) — по дням, затем по времени. */
export async function listEntries(c: Conn, ownerId: string, from: string, to: string): Promise<(Entry & { date: string })[]> {
  return c
    .select({ ...columns, date: dayMeals.date })
    .from(entries)
    .innerJoin(dayMeals, eq(dayMeals.id, entries.mealId))
    .where(and(eq(entries.ownerId, ownerId), gte(dayMeals.date, from), lte(dayMeals.date, to)))
    .orderBy(asc(dayMeals.date), asc(entries.eatenAt), asc(entries.createdAt));
}

/**
 * Калории по местным дням from…to включительно (по дню приёма, как listEntries) —
 * одним агрегатом, без самих записей: [{ date: "2026-09-28", kcal: 2310 }, …] по
 * дням. Дней без записей нет; неизвестные ккал записи считаются за 0.
 */
export async function kcalByDay(c: Conn, ownerId: string, from: string, to: string): Promise<{ date: string; kcal: number }[]> {
  return c
    .select({
      date: dayMeals.date,
      kcal: sql`coalesce(sum((${entries.nutrients}->>'kcal')::float8), 0)`.mapWith(Number),
    })
    .from(entries)
    .innerJoin(dayMeals, and(eq(dayMeals.id, entries.mealId), eq(dayMeals.ownerId, ownerId)))
    .where(and(eq(entries.ownerId, ownerId), gte(dayMeals.date, from), lte(dayMeals.date, to)))
    .groupBy(dayMeals.date)
    .orderBy(asc(dayMeals.date));
}

/** День дневника: приёмы дня по порядку с записями и итогами (GET /api/entries, экран дня). */
export async function loadDayData(c: Conn, ownerId: string, date: string, tz: string): Promise<DayData> {
  const [meals, items] = await Promise.all([
    listDayMeals(c, ownerId, date),
    selectEntries(c)
      .where(and(eq(entries.ownerId, ownerId), eq(dayMeals.date, date)))
      .orderBy(asc(entries.eatenAt), asc(entries.createdAt)),
  ]);
  const views = meals.map((m): DayMealView => {
    const own = items.filter((e) => e.mealId === m.id);
    return {
      id: m.id,
      name: m.name,
      position: m.position,
      time: own.length ? formatTime(own[0].eatenAt, tz) : null,
      lastAt: own.length ? new Date(Math.max(...own.map((e) => e.eatenAt.getTime()))) : null,
      entries: own,
      totals: sum(own.map((e) => e.nutrients)),
    };
  });
  return { date, entries: items, totals: sum(items.map((e) => e.nutrients)), meals: views };
}

export type EntrySource = { foodId: string } | { recipeId: string };

export type NewEntry = EntrySource & {
  grams: number;
  /** Местный день «YYYY-MM-DD»; по умолчанию — день приёма mealId, иначе день eatenAt, иначе сегодня. */
  date?: string | null;
  /**
   * Когда съедено по часам телефона (офлайн-очередь, виджет) — берётся, если
   * попадает в день записи. Проверку «не дальше двух суток» делает маршрут.
   */
  eatenAt?: Date | null;
  /** Явное местное время «HH:MM». */
  time?: string | null;
  /** Уже начатый приём дня. */
  mealId?: string | null;
  /** Приём по названию: приём дня с ним или новый (newMeal — всегда новый). */
  mealName?: string | null;
  newMeal?: boolean;
  /** Вид приёма от старых клиентов: название — готовое по виду («lunch» → «Обед»). */
  meal?: Meal | null;
};

type Ctx = { tz?: string; now?: Date };

/**
 * Новая запись (POST /api/entries). Приём: mealId — этот (другого дня, чем date, —
 * BadRequestError; не нашёлся — по mealName, без него — NotFoundError); название (или старый вид) —
 * приём дня с ним либо новый на место по списку пользователя; ничего —
 * приём по умолчанию (domain/meals.ts defaultMealTarget).
 * Время: явное time → время с телефона в тот же день → сегодня «сейчас» →
 * время первой записи приёма → типичное время готового приёма / вида.
 */
export async function createEntry(db: DB, ownerId: string, input: NewEntry, ctx: Ctx = {}): Promise<Entry> {
  const tz = ctx.tz ?? DEFAULT_TZ;
  const now = ctx.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockMeals(tx, ownerId);
    const snapshot = await snapshotOf(tx, ownerId, input);

    let meal: DayMeal;
    let date: string;
    // Приёма нет, а название есть: его удалили, пока запись ждала в офлайн-очереди, —
    // запись встаёт в приём дня с этим названием (или в новый), а не теряется.
    const found = input.mealId ? await getDayMeal(tx, ownerId, input.mealId) : null;
    if (input.mealId && !found && !normalizeMealName(input.mealName)) throw new NotFoundError("meal not found");
    if (found) {
      if (input.date && input.date !== found.date) throw new BadRequestError("meal is on another day");
      meal = found;
      date = found.date;
    } else {
      date = input.date ?? todayIn(tz, input.eatenAt ?? now);
      const plan = await mealPlanOf(tx, ownerId);
      const name = normalizeMealName(input.mealName) ?? (input.meal ? MEAL_RU[input.meal] : null);
      const clientAt = input.eatenAt && zonedParts(input.eatenAt, tz).date === date ? input.eatenAt : null;
      meal = name
        ? await mealByName(tx, ownerId, date, name, input.newMeal ?? false, plan)
        : await defaultDayMeal(tx, ownerId, date, { plan, tz, at: clientAt ?? now });
    }

    const eatenAt = await eatenAtFor(tx, { date, meal, input, tz, now });
    const [row] = await tx
      .insert(entries)
      .values({
        ownerId,
        mealId: meal.id,
        eatenAt,
        meal: input.meal ?? mealKindOf(meal.name, zonedParts(eatenAt, tz).hour),
        grams: input.grams,
        ...snapshot,
      })
      .returning({ id: entries.id });
    return (await entryById(tx, ownerId, row.id))!;
  });
}

/** Снимок записи из продукта или своего блюда; чужие — NotFoundError. */
async function snapshotOf(tx: Conn, ownerId: string, input: NewEntry) {
  if ("recipeId" in input) {
    // Своё блюдо: снимок из его КБЖУ на 100 г; счётчик — для сортировки «Мои блюда».
    const [recipe] = await tx
      .update(recipes)
      .set({ useCount: sql`${recipes.useCount} + 1`, lastUsedAt: new Date() })
      .where(and(eq(recipes.id, input.recipeId), eq(recipes.ownerId, ownerId)))
      .returning({ id: recipes.id, name: recipes.name, kind: recipes.kind, per100g: recipes.nutrientsPer100g });
    if (!recipe) throw new NotFoundError("recipe not found");
    return {
      inputMethod: recipe.kind === "template" ? ("template" as const) : ("recipe" as const),
      title: recipe.name,
      recipeId: recipe.id,
      nutrients: scale(recipe.per100g, input.grams),
    };
  }
  // Продукт: общий справочник или свой — чужие личные продукты недоступны.
  const [food] = await tx
    .select({ id: foods.id, nameRu: foods.nameRu, brand: foods.brand, per100g: foods.nutrientsPer100g })
    .from(foods)
    .where(and(eq(foods.id, input.foodId), or(isNull(foods.ownerId), eq(foods.ownerId, ownerId))));
  if (!food) throw new NotFoundError("food not found");
  return {
    inputMethod: "product" as const,
    title: food.brand ? `${food.nameRu} · ${food.brand}` : food.nameRu,
    foodId: food.id,
    nutrients: scale(food.per100g, input.grams),
  };
}

async function eatenAtFor(
  tx: Conn,
  { date, meal, input, tz, now }: { date: string; meal: DayMeal; input: NewEntry; tz: string; now: Date },
): Promise<Date> {
  const time = parseTime(input.time);
  if (time) return zonedTime(date, time.hour, time.minute, tz);
  if (input.eatenAt && zonedParts(input.eatenAt, tz).date === date) return input.eatenAt;
  if (date === todayIn(tz, now)) return now;
  // Прошлый (или будущий) день: к уже начатому приёму — его время, иначе
  // типичное время готового приёма, своего названия — по виду в полдень.
  const { firstAt } = await mealTimes(tx, meal.id);
  if (firstAt) return firstAt;
  const preset = presetOf(meal.name);
  const [h, m] = preset ? PRESET_TIME[preset] : MEAL_TIME[mealKindOf(meal.name, 12)];
  return zonedTime(date, h, m, tz);
}

async function entryById(c: Conn, ownerId: string, id: string): Promise<Entry | null> {
  const [row] = await selectEntries(c).where(and(eq(entries.id, id), eq(entries.ownerId, ownerId)));
  return row ?? null;
}

export type EntryPatch = {
  grams?: number;
  /** Перенести в приём этого же дня. */
  mealId?: string | null;
  /** Перенести в приём дня с этим названием (newMeal — в новый). */
  mealName?: string | null;
  newMeal?: boolean;
  /**
   * С mealName: местное «HH:MM» приёма, если запись оказалась в нём одна (новый
   * приём; время выбрали в листе — показ времени включён). В приёме с другими
   * записями время — его.
   */
  time?: string | null;
  /** Старые клиенты: смена вида переносит в готовый приём («lunch» → «Обед»). */
  meal?: Meal | null;
};

/**
 * Правка записи (PATCH /api/entries/:id). Граммы пересчитывают снимок
 * пропорционально — без обращения к справочнику. mealId / mealName / meal
 * переносят запись в другой приём того же дня: в приём с записями — на время
 * его первой записи, в новый — время прежнее (или time); опустевший приём удаляется.
 */
export async function updateEntry(db: DB, ownerId: string, id: string, patch: EntryPatch, ctx: Ctx = {}): Promise<Entry> {
  const tz = ctx.tz ?? DEFAULT_TZ;
  return db.transaction(async (tx) => {
    await lockMeals(tx, ownerId);
    const current = await entryById(tx, ownerId, id);
    if (!current) throw new NotFoundError("entry not found");
    const from = (await getDayMeal(tx, ownerId, current.mealId))!;

    const grams = patch.grams ?? current.grams;
    const nutrients =
      grams === current.grams || current.grams <= 0
        ? current.nutrients
        : scale(per100gOf(current.nutrients, current.grams), grams);

    let target: DayMeal | null = null;
    const mealName = patch.mealId ? null : normalizeMealName(patch.mealName);
    if (patch.mealId) {
      target = await getDayMeal(tx, ownerId, patch.mealId);
      if (!target) throw new NotFoundError("meal not found");
      if (target.date !== from.date) throw new BadRequestError("meal is on another day");
    } else {
      // Тот же вид (старый лист правки присылает его всегда) — не перенос.
      const legacy = patch.meal && patch.meal !== current.meal ? MEAL_RU[patch.meal] : null;
      const name = mealName ?? legacy;
      const same = name != null && mealKey(name) === mealKey(from.name);
      // «Новый» приём с тем же названием для единственной записи приёма — это он
      // же: иначе приём пересоздался бы и молча уехал в конец дня.
      if (name && (!same || (patch.newMeal && (await mealSize(tx, from.id)) > 1))) {
        target = await mealByName(tx, ownerId, from.date, name, patch.newMeal ?? false, await mealPlanOf(tx, ownerId));
      }
    }

    const moving = target != null && target.id !== from.id;
    // Время из листа — приёму, в котором запись одна: новому или своему (тот же «новый»).
    const time = mealName ? parseTime(patch.time) : null;
    let eatenAt = current.eatenAt;
    if (moving) {
      // В приём с записями — на его время: время приёма и Здоровье не расходятся.
      const { firstAt } = await mealTimes(tx, target!.id);
      if (firstAt) eatenAt = firstAt;
      else if (time) eatenAt = zonedTime(from.date, time.hour, time.minute, tz);
    } else if (time && (await mealSize(tx, from.id)) === 1) {
      eatenAt = zonedTime(from.date, time.hour, time.minute, tz);
    }
    const retimed = eatenAt.getTime() !== current.eatenAt.getTime();
    const kind =
      patch.meal ?? (moving || retimed ? mealKindOf((target ?? from).name, zonedParts(eatenAt, tz).hour) : current.meal);

    await tx
      .update(entries)
      .set({ grams, nutrients, eatenAt, meal: kind, mealId: moving ? target!.id : from.id })
      .where(and(eq(entries.id, id), eq(entries.ownerId, ownerId)));
    if (moving) await dropIfEmpty(tx, from.id);
    return (await entryById(tx, ownerId, id))!;
  });
}

/** Сколько записей в приёме. */
async function mealSize(tx: Conn, mealId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(entries).where(eq(entries.mealId, mealId));
  return Number(r?.n ?? 0);
}

/** Удалить запись; опустевший приём удаляется следом. */
export async function deleteEntry(db: DB, ownerId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockMeals(tx, ownerId);
    const [row] = await tx
      .delete(entries)
      .where(and(eq(entries.id, id), eq(entries.ownerId, ownerId)))
      .returning({ mealId: entries.mealId });
    if (!row) return false;
    await dropIfEmpty(tx, row.mealId);
    return true;
  });
}

/** Недавние продукты владельца — для быстрого повторного добавления. */
export async function recentFoods(db: DB, ownerId: string, limit = 8) {
  return db
    .select({
      foodId: entries.foodId,
      title: sql<string>`max(${entries.title})`,
      lastGrams: sql<number>`(array_agg(${entries.grams} order by ${entries.eatenAt} desc))[1]`,
      lastAt: sql<Date>`max(${entries.eatenAt})`,
    })
    .from(entries)
    .where(and(eq(entries.ownerId, ownerId), sql`${entries.foodId} is not null`))
    .groupBy(entries.foodId)
    .orderBy(sql`max(${entries.eatenAt}) desc`)
    .limit(limit);
}
