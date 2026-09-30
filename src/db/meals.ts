// Приёмы пищи дня (day_meals): название и порядок в дне, записи дневника
// принадлежат приёму. Новый приём встаёт по списку пользователя из Профиля
// (domain/meals.ts placeNewMeal), внутри дня его можно передвинуть выше/ниже.
// Пустых приёмов не бывает: приём удаляется вместе с последней записью.
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { type Meal, todayIn, zonedParts, zonedTime } from "@/domain/day";
import { defaultMealTarget, mealKey, mealKindOf, normalizeMealName, parseTime, placeNewMeal } from "@/domain/meals";
import type { DB } from ".";
import { BadRequestError, NotFoundError } from "./errors";
import { getMealSettings } from "./profile";
import type * as schema from "./schema";
import { dayMeals, entries } from "./schema";

/** База или транзакция — помощники работают и там, и там. */
export type Conn = PgDatabase<NodePgQueryResultHKT, typeof schema>;

export type DayMeal = { id: string; date: string; name: string; position: number };

const mealColumns = { id: dayMeals.id, date: dayMeals.date, name: dayMeals.name, position: dayMeals.position };

/** Приёмы дня по порядку. */
export async function listDayMeals(c: Conn, ownerId: string, date: string): Promise<DayMeal[]> {
  return c
    .select(mealColumns)
    .from(dayMeals)
    .where(and(eq(dayMeals.ownerId, ownerId), eq(dayMeals.date, date)))
    .orderBy(asc(dayMeals.position), asc(dayMeals.createdAt), asc(dayMeals.id));
}

/** Приём владельца; чужой или удалённый — null. */
export async function getDayMeal(c: Conn, ownerId: string, id: string): Promise<DayMeal | null> {
  const [m] = await c
    .select(mealColumns)
    .from(dayMeals)
    .where(and(eq(dayMeals.id, id), eq(dayMeals.ownerId, ownerId)));
  return m ?? null;
}

/** Время первой и последней записи приёма (у пустого — null). */
export async function mealTimes(c: Conn, mealId: string): Promise<{ firstAt: Date | null; lastAt: Date | null }> {
  const [t] = await c
    .select({
      firstAt: sql`min(${entries.eatenAt})`.mapWith(entries.eatenAt),
      lastAt: sql`max(${entries.eatenAt})`.mapWith(entries.eatenAt),
    })
    .from(entries)
    .where(eq(entries.mealId, mealId));
  return { firstAt: t?.firstAt ?? null, lastAt: t?.lastAt ?? null };
}

/**
 * Приёмы владельца меняются по одному запросу за раз (до конца транзакции):
 * две записи, отправленные подряд, не заведут два одинаковых «Перекуса».
 */
export async function lockMeals(tx: Conn, ownerId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(7212, hashtext(${ownerId}))`);
}

/** Позиции дня заново 1…n в том же порядке — когда дробные позиции исчерпались. */
async function renumber(tx: Conn, day: DayMeal[]): Promise<DayMeal[]> {
  const out: DayMeal[] = [];
  for (const [i, m] of day.entries()) {
    if (m.position !== i + 1) await tx.update(dayMeals).set({ position: i + 1 }).where(eq(dayMeals.id, m.id));
    out.push({ ...m, position: i + 1 });
  }
  return out;
}

/** Новый приём дня на место по списку пользователя. */
export async function insertDayMeal(
  tx: Conn,
  ownerId: string,
  date: string,
  name: string,
  plan: readonly string[],
): Promise<DayMeal> {
  let day = await listDayMeals(tx, ownerId, date);
  let position = placeNewMeal(day, name, plan);
  if (day.some((m) => m.position === position)) {
    day = await renumber(tx, day);
    position = placeNewMeal(day, name, plan);
  }
  const [row] = await tx.insert(dayMeals).values({ ownerId, date, name, position }).returning(mealColumns);
  return row;
}

/**
 * Приём по названию в день date: newMeal — всегда новый, иначе приём дня с
 * тем же названием (из нескольких — последний), а нет такого — новый.
 */
export async function mealByName(
  tx: Conn,
  ownerId: string,
  date: string,
  name: string,
  newMeal: boolean,
  plan: readonly string[],
): Promise<DayMeal> {
  if (!newMeal) {
    const hit = (await listDayMeals(tx, ownerId, date)).findLast((m) => mealKey(m.name) === mealKey(name));
    if (hit) return hit;
  }
  return insertDayMeal(tx, ownerId, date, name, plan);
}

/**
 * Приём по умолчанию, когда клиент его не указал (виджет, старые клиенты):
 * domain/meals.ts defaultMealTarget на момент at — уже начатый приём или новый.
 */
export async function defaultDayMeal(
  tx: Conn,
  ownerId: string,
  date: string,
  ctx: { plan: readonly string[]; tz: string; at: Date },
): Promise<DayMeal> {
  const rows = await tx
    .select({ ...mealColumns, lastAt: sql`max(${entries.eatenAt})`.mapWith(entries.eatenAt) })
    .from(dayMeals)
    .leftJoin(entries, eq(entries.mealId, dayMeals.id))
    .where(and(eq(dayMeals.ownerId, ownerId), eq(dayMeals.date, date)))
    .groupBy(dayMeals.id)
    .orderBy(asc(dayMeals.position), asc(dayMeals.createdAt), asc(dayMeals.id));
  const target = defaultMealTarget({
    dayMeals: rows,
    plan: ctx.plan,
    isToday: date === todayIn(ctx.tz, ctx.at),
    now: ctx.at,
    nowLocal: zonedParts(ctx.at, ctx.tz),
  });
  if ("mealId" in target) {
    const hit = rows.find((m) => m.id === target.mealId)!;
    return { id: hit.id, date: hit.date, name: hit.name, position: hit.position };
  }
  return insertDayMeal(tx, ownerId, date, target.name, ctx.plan);
}

/** Удалить приём, если в нём не осталось записей. */
export async function dropIfEmpty(tx: Conn, mealId: string): Promise<void> {
  await tx
    .delete(dayMeals)
    .where(and(eq(dayMeals.id, mealId), notExists(tx.select({ one: sql`1` }).from(entries).where(eq(entries.mealId, mealId)))));
}

/** Вид приёма у записей приёма — по его названию и местному часу каждой. */
async function recomputeKinds(tx: Conn, mealId: string, name: string, tz: string): Promise<void> {
  const rows = await tx.select({ id: entries.id, eatenAt: entries.eatenAt }).from(entries).where(eq(entries.mealId, mealId));
  const byKind = new Map<Meal, string[]>();
  for (const r of rows) {
    const kind = mealKindOf(name, zonedParts(r.eatenAt, tz).hour);
    byKind.set(kind, [...(byKind.get(kind) ?? []), r.id]);
  }
  for (const [kind, ids] of byKind) await tx.update(entries).set({ meal: kind }).where(inArray(entries.id, ids));
}

export type MealPatch = { name?: string; time?: string; move?: "up" | "down" };

/**
 * Правка приёма (PATCH /api/meals/:id): name — переименовать (вид записей
 * пересчитывается), time — «HH:MM»: все записи приёма на это местное время
 * его дня, move — поменяться местами с соседом выше/ниже (у края — ничего).
 * Возвращает приёмы дня по порядку.
 */
export async function updateDayMeal(
  db: DB,
  ownerId: string,
  id: string,
  patch: MealPatch,
  tz: string,
): Promise<Pick<DayMeal, "id" | "name" | "position">[]> {
  const name = patch.name != null ? normalizeMealName(patch.name) : undefined;
  const time = patch.time != null ? parseTime(patch.time) : undefined;
  if (name === null || time === null) throw new BadRequestError("bad meal patch");

  return db.transaction(async (tx) => {
    await lockMeals(tx, ownerId);
    const meal = await getDayMeal(tx, ownerId, id);
    if (!meal) throw new NotFoundError("meal not found");

    if (name && name !== meal.name) await tx.update(dayMeals).set({ name }).where(eq(dayMeals.id, id));
    if (time) {
      const at = zonedTime(meal.date, time.hour, time.minute, tz);
      await tx.update(entries).set({ eatenAt: at }).where(and(eq(entries.mealId, id), eq(entries.ownerId, ownerId)));
    }
    if (name || time) await recomputeKinds(tx, id, name ?? meal.name, tz);

    let day = await listDayMeals(tx, ownerId, meal.date);
    if (patch.move) {
      const i = day.findIndex((m) => m.id === id);
      const j = patch.move === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < day.length) {
        if (day[i].position === day[j].position) day = await renumber(tx, day);
        const [a, b] = [day[i], day[j]];
        await tx.update(dayMeals).set({ position: b.position }).where(eq(dayMeals.id, a.id));
        await tx.update(dayMeals).set({ position: a.position }).where(eq(dayMeals.id, b.id));
        day = await listDayMeals(tx, ownerId, meal.date);
      }
    }
    return day.map(({ id, name, position }) => ({ id, name, position }));
  });
}

/** Удалить приём вместе с записями (DELETE /api/meals/:id). Возвращает id удалённых записей. */
export async function deleteDayMeal(db: DB, ownerId: string, id: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    await lockMeals(tx, ownerId);
    const meal = await getDayMeal(tx, ownerId, id);
    if (!meal) throw new NotFoundError("meal not found");
    const gone = await tx
      .delete(entries)
      .where(and(eq(entries.mealId, id), eq(entries.ownerId, ownerId)))
      .returning({ id: entries.id });
    await tx.delete(dayMeals).where(and(eq(dayMeals.id, id), eq(dayMeals.ownerId, ownerId)));
    return gone.map((r) => r.id);
  });
}

/** Список приёмов пользователя — для размещения новых приёмов. */
export async function mealPlanOf(c: Conn, ownerId: string): Promise<string[]> {
  return (await getMealSettings(c, ownerId)).plan;
}
