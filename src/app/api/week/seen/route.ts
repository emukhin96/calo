import { z } from "zod";
import { isIsoDate } from "@/domain/day";
import { apiSession } from "@/lib/api";
import { markWeekSeen } from "@/lib/week";

/** POST /api/week/seen { weekStart } — «Понятно»: больше не открывать разбор сам. */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = z.object({ weekStart: z.string().refine(isIsoDate) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  await markWeekSeen(session.user.id, body.data.weekStart);
  return new Response(null, { status: 204 });
}
