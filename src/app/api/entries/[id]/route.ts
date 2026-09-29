import { z } from "zod";
import { db } from "@/db";
import { deleteEntry, NotFoundError, updateEntry } from "@/db/entries";
import { MEALS } from "@/domain/day";
import { apiSession } from "@/lib/api";

const PatchBody = z
  .object({ grams: z.number().positive().max(5000).optional(), meal: z.enum(MEALS).optional() })
  .refine((b) => b.grams != null || b.meal != null);

/** PATCH /api/entries/:id { grams?, meal? } */
export async function PATCH(req: Request, ctx: RouteContext<"/api/entries/[id]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  const body = PatchBody.safeParse(await req.json().catch(() => null));
  if (!body.success || !z.uuid().safeParse(id).success) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    return Response.json(await updateEntry(db, session.user.id, id, body.data));
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "not found" }, { status: 404 });
    throw e;
  }
}

/** DELETE /api/entries/:id */
export async function DELETE(req: Request, ctx: RouteContext<"/api/entries/[id]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "bad request" }, { status: 400 });
  const ok = await deleteEntry(db, session.user.id, id);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "not found" }, { status: 404 });
}
