import { db } from "@/db";
import { listEntries } from "@/db/entries";
import { isIsoDate, todayIn } from "@/domain/day";
import { entriesToCsv } from "@/domain/csv";
import { apiSession } from "@/lib/api";
import { userTimeZone } from "@/lib/tz";

/**
 * GET /api/export?from=2026-09-01&to=2026-09-30 — дневник в CSV (по умолчанию
 * весь). Дни — дни приёмов пищи, «Приём пищи» — название приёма.
 */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const tz = await userTimeZone(session.user.id);
  const sp = new URL(req.url).searchParams;
  const today = todayIn(tz);
  const from = isIsoDate(sp.get("from")) ? sp.get("from")! : "2000-01-01";
  const to = isIsoDate(sp.get("to")) ? sp.get("to")! : today;
  const rows = await listEntries(db, session.user.id, from, to);
  return new Response(entriesToCsv(rows, tz), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="calo-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
