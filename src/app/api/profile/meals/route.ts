import { db } from "@/db";
import { NotFoundError } from "@/db/errors";
import { getMealSettings, saveMealSettings } from "@/db/profile";
import { normalizeMealPlan } from "@/domain/meals";
import { apiSession } from "@/lib/api";
import { MealSettingsBody } from "@/lib/profile-schema";

/** GET /api/profile/meals → { plan, showTimes } — свой порядок приёмов пищи и показ времени. */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  return Response.json(await getMealSettings(db, session.user.id));
}

/**
 * PUT /api/profile/meals { plan?, showTimes? } → { plan, showTimes }. plan —
 * 1–12 названий по порядку (повторы можно); приёмы в уже заполненных днях
 * не меняются. До онбординга — 409.
 */
export async function PUT(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = MealSettingsBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  const plan = body.data.plan === undefined ? undefined : normalizeMealPlan(body.data.plan);
  if (plan === null) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    return Response.json(await saveMealSettings(db, session.user.id, { plan, showTimes: body.data.showTimes }));
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "onboarding required" }, { status: 409 });
    throw e;
  }
}
