import { z } from "zod";
import { db } from "@/db";
import { deleteWeight } from "@/db/profile";
import { apiSession } from "@/lib/api";

/** DELETE /api/weight/:id — ошибочное взвешивание. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/weight/[id]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "bad request" }, { status: 400 });
  await deleteWeight(db, session.user.id, id);
  return new Response(null, { status: 204 });
}
