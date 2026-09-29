import { z } from "zod";
import { db } from "@/db";
import { addWeight, weightHistory } from "@/db/profile";
import { apiSession } from "@/lib/api";
import { WeightKg } from "@/lib/profile-schema";

/** GET /api/weight — история веса; POST { kg, measuredAt?, source?, externalId? } — взвешивание. */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  return Response.json({ items: await weightHistory(db, session.user.id) });
}

export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = z
    .object({
      kg: WeightKg,
      // Из Apple Health (нативное приложение): время и UUID замера.
      measuredAt: z.iso.datetime().optional(),
      source: z.enum(["manual", "apple_health"]).default("manual"),
      externalId: z.string().max(100).optional(),
    })
    .safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  const { kg, measuredAt, source, externalId } = body.data;
  await addWeight(db, session.user.id, kg, measuredAt ? new Date(measuredAt) : new Date(), { source, externalId });
  return Response.json({ items: await weightHistory(db, session.user.id) }, { status: 201 });
}
