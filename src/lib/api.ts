import "server-only";
import { auth } from "./auth";

/** Сессия для API (cookie или Authorization: Bearer). Без неё — 401. */
export async function apiSession(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { session: null, error: Response.json({ error: "unauthorized" }, { status: 401 }) } as const;
  return { session, error: null } as const;
}
