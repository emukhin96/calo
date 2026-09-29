import { z } from "zod";
import { db } from "@/db";
import { addWeight, weightHistory } from "@/db/profile";
import { apiSession } from "@/lib/api";
import { WeightKg } from "@/lib/profile-schema";

/** GET /api/weight — история веса; POST { kg } — новое взвешивание. */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  return Response.json({ items: await weightHistory(db, session.user.id) });
}

export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = z.object({ kg: WeightKg }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  await addWeight(db, session.user.id, body.data.kg);
  return Response.json({ items: await weightHistory(db, session.user.id) }, { status: 201 });
}
