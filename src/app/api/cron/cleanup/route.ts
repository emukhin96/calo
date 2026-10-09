import { timingSafeEqual } from "node:crypto";
import { lt } from "drizzle-orm";
import { db } from "@/db";
import { session, verification } from "@/db/schema";

/**
 * POST /api/cron/cleanup — раз в час из cron на сервере (deploy/vps/cron-hourly.sh):
 * просроченные токены ссылок входа и удаления аккаунта и истёкшие сессии. Сам
 * better-auth их не трогает: ссылку входа он гасит, только когда по ней перешли, а
 * с открытой регистрацией непрошеных ссылок много. Доступ — по заголовку
 * Authorization: Bearer CRON_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  if (!secret || got.length !== Buffer.byteLength(secret) || !timingSafeEqual(got, Buffer.from(secret))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const now = new Date();
  const verifications = await db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id });
  const sessions = await db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id });
  return Response.json({ verifications: verifications.length, sessions: sessions.length });
}
