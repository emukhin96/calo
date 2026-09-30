import { z } from "zod";
import { db } from "@/db";
import { BadRequestError, deleteEntry, NotFoundError, updateEntry } from "@/db/entries";
import { MEALS } from "@/domain/day";
import { isTime, MEAL_NAME_MAX } from "@/domain/meals";
import { apiSession } from "@/lib/api";
import { userTimeZone } from "@/lib/tz";

const PatchBody = z
  .object({
    grams: z.number().positive().max(5000).optional(),
    /** Перенести в приём того же дня. */
    mealId: z.uuid().optional(),
    /** Перенести в приём дня с этим названием (newMeal — в новый). */
    mealName: z.string().trim().min(1).max(MEAL_NAME_MAX * 2).optional(), // 40 кодовых точек — normalizeMealName
    newMeal: z.boolean().optional(),
    /** С mealName — местное «HH:MM» нового приёма (время приёмов включено в Профиле). */
    time: z.string().refine(isTime).optional(),
    /** Вид приёма от старых клиентов; другой вид переносит запись в «Завтрак/Обед/…». */
    meal: z.enum(MEALS).optional(),
  })
  .refine((b) => b.grams != null || b.meal != null || b.mealName != null || b.mealId != null);

/**
 * PATCH /api/entries/:id { grams?, mealId? | mealName? (+newMeal, time?), meal? } —
 * граммы и перенос в другой приём того же дня (db/entries.ts updateEntry).
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/entries/[id]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success || !z.uuid().safeParse(id).success) return Response.json({ error: "bad request" }, { status: 400 });
  const tz = await userTimeZone(session.user.id);
  try {
    return Response.json(await updateEntry(db, session.user.id, id, body.data, { tz }));
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "not found" }, { status: 404 });
    if (e instanceof BadRequestError) return Response.json({ error: "bad request" }, { status: 400 });
    throw e;
  }
}

/** DELETE /api/entries/:id — опустевший приём удаляется следом. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/entries/[id]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "bad request" }, { status: 400 });
  const ok = await deleteEntry(db, session.user.id, id);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "not found" }, { status: 404 });
}
