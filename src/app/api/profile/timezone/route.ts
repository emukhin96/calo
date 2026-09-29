import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { isValidTimeZone } from "@/domain/day";
import { apiSession } from "@/lib/api";

/** POST /api/profile/timezone { timezone } — телефон оказался в другом часовом поясе. */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = z.object({ timezone: z.string().refine(isValidTimeZone) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  await db.update(profiles).set({ timezone: body.data.timezone }).where(eq(profiles.ownerId, session.user.id));
  return new Response(null, { status: 204 });
}
