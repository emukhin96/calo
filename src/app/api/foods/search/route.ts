import { db } from "@/db";
import { searchFoods } from "@/db/foods";
import { apiSession } from "@/lib/api";

/** GET /api/foods/search?q=сливки 20 — свой справочник (USDA, базовые, мои, сохранённые из OFF). */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? "";
  const items = await searchFoods(db, session.user.id, q);
  return Response.json({ items });
}
