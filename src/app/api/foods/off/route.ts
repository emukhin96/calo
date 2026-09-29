import { apiSession } from "@/lib/api";
import { searchOff } from "@/lib/off";

/** GET /api/foods/off?q=rummo — поиск в Open Food Facts (без сохранения). */
export async function GET(req: Request) {
  const { error } = await apiSession(req);
  if (error) return error;
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return Response.json({ items: [] });
  try {
    const items = await searchOff(q);
    return Response.json({
      items: items.map((f) => ({ code: f.sourceRef, nameRu: f.nameRu, brand: f.brand, nutrientsPer100g: f.nutrientsPer100g })),
    });
  } catch (e) {
    console.error("[off] search", e);
    return Response.json({ items: [], error: "Open Food Facts не отвечает" }, { status: 502 });
  }
}
