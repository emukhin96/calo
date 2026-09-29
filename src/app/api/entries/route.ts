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
  const tz = await userTimeZone();
  const date = new URL(req.url).searchParams.get("date");
  return Response.json(await loadDay(session.user.id, isIsoDate(date) ? date : todayIn(tz), tz));
}

const CreateBody = z.object({
  foodId: z.uuid(),
  grams: z.number().positive().max(5000),
  meal: z.enum(MEALS).optional(),
  date: z.string().refine(isIsoDate).optional(),
});

/** POST /api/entries { foodId, grams, meal?, date? } — нутриенты считает сервер. */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = CreateBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });

  const tz = await userTimeZone();
  const now = new Date();
  const date = body.data.date ?? todayIn(tz, now);
  const meal = body.data.meal ?? mealByHour(zonedParts(now, tz).hour);
  try {
    const entry = await createEntry(db, session.user.id, {
      foodId: body.data.foodId,
      grams: body.data.grams,
      meal,
      eatenAt: eatenAtFor(date, meal, tz, now),
    });
    return Response.json(entry, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "food not found" }, { status: 404 });
    throw e;
  }
}
