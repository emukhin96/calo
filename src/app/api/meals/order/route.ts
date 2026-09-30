import { z } from "zod";
import { db } from "@/db";
import { MealOrderConflictError, reorderDayMeals } from "@/db/meals";
import { isIsoDate } from "@/domain/day";
import { apiSession } from "@/lib/api";

const OrderBody = z.object({
  /** Местный день приёмов. */
  date: z.string().refine(isIsoDate),
  /** Все приёмы этого дня (GET /api/entries → meals[].id), каждый один раз, в новом порядке. */
  ids: z.array(z.uuid()).min(1).max(500),
});

/**
 * PUT /api/meals/order { date, ids } — новый порядок приёмов дня (перетаскивание
 * в дневнике) → { meals: {id, name, position}[] } по новому порядку. ids — не
 * ровно приёмы этого дня (приём добавили или удалили в другом окне, чужой
 * приём) — 409 { error, meals } с порядком, как он есть сейчас: клиент
 * возвращает его и обновляет экран.
 */
export async function PUT(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = OrderBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    return Response.json({ meals: await reorderDayMeals(db, session.user.id, body.data.date, body.data.ids) });
  } catch (e) {
    if (e instanceof MealOrderConflictError) return Response.json({ error: "conflict", meals: e.current }, { status: 409 });
    throw e;
  }
}
