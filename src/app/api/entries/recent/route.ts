import { db } from "@/db";
import { recentFoods } from "@/db/entries";
import { getFoods } from "@/db/foods";
import { apiSession } from "@/lib/api";

/** GET /api/entries/recent — недавние продукты с последней порцией, для быстрого повтора. */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const recent = await recentFoods(db, session.user.id);
  const found = new Map(
    (await getFoods(db, session.user.id, recent.map((r) => r.foodId!))).map((f) => [f.id, f]),
  );
  const items = recent.flatMap((r) => {
    const food = found.get(r.foodId!);
    return food ? [{ food, lastGrams: r.lastGrams }] : [];
  });
  return Response.json({ items });
}
