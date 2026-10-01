import { shopCountry } from "@/domain/country";
import { apiSession } from "@/lib/api";
import { searchOff } from "@/lib/off";
import { userTimeZone } from "@/lib/tz";

/**
 * GET /api/foods/off?q=rummo — поиск в Open Food Facts (без сохранения).
 * Товары страны, где сейчас пользователь (по часовому поясу профиля), — выше;
 * local — товар продаётся в этой стране.
 */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return Response.json({ items: [] });
  try {
    const items = await searchOff(q, { country: shopCountry(await userTimeZone(session.user.id)) });
    return Response.json({
      items: items.map((f) => ({ code: f.code, nameRu: f.nameRu, brand: f.brand, nutrientsPer100g: f.nutrientsPer100g, local: f.local })),
    });
  } catch (e) {
    console.error("[off] search", e);
    return Response.json({ items: [], error: "Open Food Facts не отвечает" }, { status: 502 });
  }
}
