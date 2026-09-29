import { z } from "zod";
import { db } from "@/db";
import { NotFoundError } from "@/db/entries";
import { compositeFromEntries, templateFromEntry } from "@/db/recipes";
import { apiSession } from "@/lib/api";

const Body = z.object({ entryIds: z.array(z.uuid()).min(1).max(40), name: z.string().trim().min(1).max(120).optional() });

/**
 * POST /api/recipes/from-entries { entryIds, name? } — «Сохранить как блюдо»:
 * одна запись → блюдо с её порцией; несколько (приём пищи) → составное блюдо.
 */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  const { entryIds, name } = body.data;
  try {
    const recipe =
      entryIds.length === 1
        ? await templateFromEntry(db, session.user.id, entryIds[0], name)
        : await compositeFromEntries(db, session.user.id, entryIds, name ?? "Мой приём пищи");
    return Response.json(recipe, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "not found" }, { status: 404 });
    throw e;
  }
}
