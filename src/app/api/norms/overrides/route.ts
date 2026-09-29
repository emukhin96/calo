import { db } from "@/db";
import { setOverride } from "@/db/profile";
import { apiSession } from "@/lib/api";
import { loadUser } from "@/lib/norms";
import { OverrideBody } from "@/lib/profile-schema";

/** PUT /api/norms/overrides { nutrient, value } — своя норма; value = null — вернуть расчётную. */
export async function PUT(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = OverrideBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  await setOverride(db, session.user.id, body.data.nutrient, body.data.value);
  return Response.json(await loadUser(session.user.id));
}
