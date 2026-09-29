import { isIsoDate, todayIn } from "@/domain/day";
import { apiSession } from "@/lib/api";
import { loadDay } from "@/lib/diary";
import { loadUser } from "@/lib/norms";
import { userTimeZone } from "@/lib/tz";

/**
 * GET /api/summary/day?date= — коротко о дне для виджета iOS
 * (Authorization: Bearer). ARCHITECTURE.md §11.
 */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const tz = await userTimeZone(session.user.id);
  const d = new URL(req.url).searchParams.get("date");
  const date = isIsoDate(d) ? d : todayIn(tz);
  const [{ totals, entries }, { norms }] = await Promise.all([loadDay(session.user.id, date, tz), loadUser(session.user.id)]);
  const r = (x: number | null | undefined) => Math.round(x ?? 0);
  return Response.json({
    date,
    kcal: r(totals.kcal),
    norm: norms?.kcal ?? null,
    protein: r(totals.protein),
    proteinNorm: norms?.nutrients.protein?.value ?? null,
    fat: r(totals.fat),
    carbs: r(totals.carbs),
    entries: entries.length,
    updatedAt: new Date().toISOString(),
  });
}
