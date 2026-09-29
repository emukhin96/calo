import { apiSession } from "@/lib/api";
import { loadUser } from "@/lib/norms";

/** GET /api/me — профиль, цель, вес, ручные правки и итоговые нормы. */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  return Response.json(await loadUser(session.user.id));
}
