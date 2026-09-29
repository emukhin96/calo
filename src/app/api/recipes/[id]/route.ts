import { z } from "zod";
import { db } from "@/db";
import { NotFoundError } from "@/db/entries";
import { deleteRecipe, getRecipe, saveComposite, saveTemplate } from "@/db/recipes";
import { apiSession } from "@/lib/api";
import { RecipeBody } from "@/lib/recipe-schema";

type Ctx = RouteContext<"/api/recipes/[id]">;
const badId = (id: string) => !z.uuid().safeParse(id).success;

export async function GET(req: Request, ctx: Ctx) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  if (badId(id)) return Response.json({ error: "bad request" }, { status: 400 });
  const recipe = await getRecipe(db, session.user.id, id);
  return recipe ? Response.json(recipe) : Response.json({ error: "not found" }, { status: 404 });
}

/** PUT /api/recipes/:id — пересчёт при сохранении; прошлые записи дневника не меняются. */
export async function PUT(req: Request, ctx: Ctx) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  const body = RecipeBody.safeParse(await req.json().catch(() => null));
  if (badId(id) || !body.success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    const recipe =
      body.data.kind === "composite"
        ? await saveComposite(db, session.user.id, body.data, id)
        : await saveTemplate(db, session.user.id, body.data, id);
    return Response.json(recipe);
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "not found" }, { status: 404 });
    throw e;
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  if (badId(id)) return Response.json({ error: "bad request" }, { status: 400 });
  return (await deleteRecipe(db, session.user.id, id))
    ? new Response(null, { status: 204 })
    : Response.json({ error: "not found" }, { status: 404 });
}
