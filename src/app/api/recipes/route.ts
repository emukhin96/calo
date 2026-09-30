import { db } from "@/db";
import { NotFoundError } from "@/db/entries";
import { listRecipes, saveComposite, saveTemplate } from "@/db/recipes";
import { type Meal, MEALS, zonedParts } from "@/domain/day";
import { mealKindOf, normalizeMealName } from "@/domain/meals";
import { apiSession } from "@/lib/api";
import { RecipeBody } from "@/lib/recipe-schema";
import { userTimeZone } from "@/lib/tz";

/**
 * GET /api/recipes?meal=breakfast | ?mealName=Перекус — мои блюда, вероятные
 * для этого приёма пищи сверху. Своё название приёма — вид по текущему часу.
 */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const sp = new URL(req.url).searchParams;
  const meal = sp.get("meal");
  const mealName = normalizeMealName(sp.get("mealName"));
  let kind: Meal | undefined = (MEALS as string[]).includes(meal ?? "") ? (meal as Meal) : undefined;
  if (!kind && mealName) kind = mealKindOf(mealName, zonedParts(new Date(), await userTimeZone(session.user.id)).hour);
  const items = await listRecipes(db, session.user.id, kind);
  return Response.json({ items });
}

/** POST /api/recipes — составное блюдо или шаблон со своим КБЖУ. */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = RecipeBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request", issues: body.error.issues }, { status: 400 });
  try {
    const recipe =
      body.data.kind === "composite"
        ? await saveComposite(db, session.user.id, body.data)
        : await saveTemplate(db, session.user.id, body.data);
    return Response.json(recipe, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "food not found" }, { status: 404 });
    throw e;
  }
}
