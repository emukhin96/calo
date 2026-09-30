import { db } from "@/db";
import { NotFoundError } from "@/db/errors";
import { getMealSettings, saveMealSettings } from "@/db/profile";
import { normalizeMealPlan, normalizeMealPlanItems } from "@/domain/meals";
import { apiSession } from "@/lib/api";
import { MealSettingsBody } from "@/lib/profile-schema";

/**
 * GET /api/profile/meals → { plan, items, showTimes }: plan — приёмы, которые
 * предлагаются при добавлении еды (по порядку, без скрытых); items — весь свой
 * список по порядку { name, hidden }[]; showTimes — показ времени приёмов.
 */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  return Response.json(await getMealSettings(db, session.user.id));
}

/**
 * PUT /api/profile/meals { items?, showTimes? } → { plan, items, showTimes }.
 * items — 1–12 приёмов по порядку { name, hidden? } (повторы можно, хотя бы один
 * не скрыт); старые клиенты присылают { plan?: string[] } — все приёмы видны.
 * Приёмы в уже заполненных днях не меняются. До онбординга — 409.
 */
export async function PUT(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = MealSettingsBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  const items = body.data.items === undefined ? undefined : normalizeMealPlanItems(body.data.items);
  const plan = body.data.plan === undefined ? undefined : normalizeMealPlan(body.data.plan);
  if (items === null || plan === null) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    return Response.json(await saveMealSettings(db, session.user.id, { items, plan, showTimes: body.data.showTimes }));
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "onboarding required" }, { status: 409 });
    throw e;
  }
}
