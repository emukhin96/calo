import { timingSafeEqual } from "node:crypto";
import { sendWeeklyDigests } from "@/lib/push";

/**
 * POST /api/cron/weekly — раз в час из cron на сервере (deploy/vps/cron-hourly.sh):
 * напоминания о разборе недели. Доступ — по заголовку Authorization: Bearer CRON_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return Response.json(await sendWeeklyDigests());
}
