import { z } from "zod";
import { db } from "@/db";
import { createEntry, NotFoundError } from "@/db/entries";
import { eatenAtFor, isIsoDate, mealByHour, MEALS, todayIn, zonedParts } from "@/domain/day";
import { apiSession } from "@/lib/api";
import { loadDay } from "@/lib/diary";
import { userTimeZone } from "@/lib/tz";

/** GET /api/entries?date=2026-09-29 — записи и итоги дня (по умолчанию сегодня). */
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
    meal: z.enum(MEALS).optional(),
    date: z.string().refine(isIsoDate).optional(),
    /** Когда съедено по часам телефона — для записей из офлайн-очереди. */
    eatenAt: z.iso.datetime().optional(),
  })
  .refine((b) => (b.foodId == null) !== (b.recipeId == null), "нужен ровно один из foodId, recipeId");

/** POST /api/entries { foodId | recipeId, grams, meal?, date? } — нутриенты считает сервер. */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = CreateBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });

  const tz = await userTimeZone(session.user.id);
  const now = new Date();
  // Время с телефона принимаем, если оно в пределах двух суток и попадает в тот
  // же местный день, куда пишем (запись отправлена из офлайн-очереди позже).
  const clientAt = body.data.eatenAt ? new Date(body.data.eatenAt) : null;
  const trusted = clientAt && Math.abs(now.getTime() - clientAt.getTime()) < 48 * 3600_000 ? clientAt : null;
  const date = body.data.date ?? todayIn(tz, trusted ?? now);
  const at = trusted && zonedParts(trusted, tz).date === date ? trusted : null;
  const meal = body.data.meal ?? mealByHour(zonedParts(at ?? now, tz).hour);
  try {
    const source = body.data.recipeId ? { recipeId: body.data.recipeId } : { foodId: body.data.foodId! };
    const entry = await createEntry(db, session.user.id, {
      ...source,
      grams: body.data.grams,
      meal,
      eatenAt: at ?? eatenAtFor(date, meal, tz, now),
    });
    return Response.json(entry, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "not found" }, { status: 404 });
    throw e;
  }
}
