import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { aiUsage } from "@/db/schema";

/** Запросов к ИИ на пользователя в день (AI_DAILY_LIMIT). Страховка от ошибок и петель, не тариф. */
export const dailyLimit = () => Number(process.env.AI_DAILY_LIMIT ?? 60);

/**
 * Учесть запрос к ИИ за местный день пользователя. true — можно выполнять,
 * false — лимит исчерпан. Счётчик увеличивается атомарно вместе с проверкой.
 */
export async function takeAiRequest(db: DB, ownerId: string, day: string, limit = dailyLimit()): Promise<boolean> {
  const [row] = await db
    .insert(aiUsage)
    .values({ ownerId, day, requests: 1 })
    .onConflictDoUpdate({ target: [aiUsage.ownerId, aiUsage.day], set: { requests: sql`${aiUsage.requests} + 1` } })
    .returning({ requests: aiUsage.requests });
  return row.requests <= limit;
}
