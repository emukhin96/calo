import { z } from "zod";
import { db } from "@/db";
import { BadRequestError, createEntry, NotFoundError } from "@/db/entries";
import { isIsoDate, MEALS, todayIn } from "@/domain/day";
import { isTime } from "@/domain/meals";
import { apiSession } from "@/lib/api";
import { loadDay } from "@/lib/diary";
import { newEntryTiming } from "@/lib/diary-date";
import { MealNameField } from "@/lib/meal-schema";
import { userTimeZone } from "@/lib/tz";

/** GET /api/entries?date=2026-09-29 — записи, итоги и приёмы пищи дня по порядку (по умолчанию сегодня). */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const tz = await userTimeZone(session.user.id);
  const date = new URL(req.url).searchParams.get("date");
  return Response.json(await loadDay(session.user.id, isIsoDate(date) ? date : todayIn(tz), tz));
}

const CreateBody = z
  .object({
    foodId: z.uuid().optional(),
    recipeId: z.uuid().optional(),
    grams: z.number().positive().max(5000),
    /** Уже начатый приём дня (GET /api/entries → meals[].id). */
    mealId: z.uuid().optional(),
    /** Приём по названию: приём дня с ним или новый. */
    mealName: MealNameField.optional(),
    /** С mealName — всегда новый приём (второй «Перекус»). */
    newMeal: z.boolean().optional(),
    /** Вид приёма — старые клиенты присылают только его. */
    meal: z.enum(MEALS).optional(),
    /** Местный день записи; позже сегодня — сегодня (lib/diary-date.ts newEntryTiming). */
    date: z.string().refine(isIsoDate).optional(),
    /** Местное время «HH:MM» в день записи — пользователь выбрал сам (время приёмов включено). */
    time: z.string().refine(isTime).optional(),
    /** Когда съедено по часам телефона — для записей из офлайн-очереди и виджета. */
    eatenAt: z.iso.datetime().optional(),
  })
  .refine((b) => (b.foodId == null) !== (b.recipeId == null), "нужен ровно один из foodId, recipeId");

/**
 * POST /api/entries { foodId | recipeId, grams, mealId? | mealName? (+newMeal), time?, date?, eatenAt?, meal? }
 * — нутриенты считает сервер. Без приёма — приём по умолчанию (db/entries.ts createEntry).
 * В будущий день запись не встаёт: date позже сегодня — сегодня (не 400 — см. newEntryTiming).
 */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = CreateBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  const { foodId, recipeId, grams, mealId, mealName, newMeal, meal } = body.data;

  const tz = await userTimeZone(session.user.id);
  const now = new Date();
  // Время с телефона — в пределах двух суток (офлайн-очередь), будущий день —
  // сегодня; попадает ли eatenAt в день записи, проверит createEntry.
  const { date, time, eatenAt } = newEntryTiming(body.data, { tz, now });

  try {
    const source = recipeId ? { recipeId } : { foodId: foodId! };
    const entry = await createEntry(
      db,
      session.user.id,
      { ...source, grams, date, eatenAt, time, mealId, mealName, newMeal, meal },
      { tz, now },
    );
    return Response.json(entry, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "not found" }, { status: 404 });
    if (e instanceof BadRequestError) return Response.json({ error: "bad request" }, { status: 400 });
    throw e;
  }
}
