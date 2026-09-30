import { z } from "zod";
import { db } from "@/db";
import { BadRequestError, NotFoundError } from "@/db/errors";
import { deleteDayMeal, updateDayMeal } from "@/db/meals";
import { isTime } from "@/domain/meals";
import { apiSession } from "@/lib/api";
import { MealNameField } from "@/lib/meal-schema";
import { userTimeZone } from "@/lib/tz";

const PatchBody = z
  .object({
    /** Новое название приёма. */
    name: MealNameField.optional(),
    /** Местное «HH:MM»: все записи приёма — на это время его дня. */
    time: z.string().refine(isTime).optional(),
    /** Поменяться местами с соседом выше / ниже. */
    move: z.enum(["up", "down"]).optional(),
  })
  .refine((b) => b.name != null || b.time != null || b.move != null);

/**
 * PATCH /api/meals/:id { name?, time?, move? } — переименовать приём,
 * поменять его время, передвинуть в дне → { meals: {id, name, position}[] }
 * (приёмы этого дня по порядку).
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/meals/[id]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success || !z.uuid().safeParse(id).success) return Response.json({ error: "bad request" }, { status: 400 });
  const tz = await userTimeZone(session.user.id);
  try {
    return Response.json({ meals: await updateDayMeal(db, session.user.id, id, body.data, tz) });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "not found" }, { status: 404 });
    if (e instanceof BadRequestError) return Response.json({ error: "bad request" }, { status: 400 });
    throw e;
  }
}

/**
 * DELETE /api/meals/:id — приём вместе с записями → { deletedEntryIds } (клиент
 * удаляет их и из Здоровья).
 */
export async function DELETE(req: Request, ctx: RouteContext<"/api/meals/[id]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    return Response.json({ deletedEntryIds: await deleteDayMeal(db, session.user.id, id) });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "not found" }, { status: 404 });
    throw e;
  }
}
