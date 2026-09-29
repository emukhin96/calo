import { db } from "@/db";
import { searchFoods } from "@/db/foods";
import { searchRecipes } from "@/db/recipes";
import { queryTokens } from "@/domain/search";
import { apiSession } from "@/lib/api";

/**
 * GET /api/foods/search?q=сливки 20 — справочник (USDA, базовые, мои, сохранённые
 * из OFF) и «Мои блюда» с подходящим названием.
 */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? "";
  const [items, recipes] = await Promise.all([
    searchFoods(db, session.user.id, q),
    searchRecipes(db, session.user.id, queryTokens(q)),
  ]);
  return Response.json({ items, recipes });
}
