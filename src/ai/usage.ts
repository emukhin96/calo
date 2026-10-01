import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { aiUsage, appMeta } from "@/db/schema";
import { todayIn } from "@/domain/day";

/** Запросов к ИИ на пользователя в день (AI_DAILY_LIMIT). Страховка от ошибок и петель, не тариф. */
export const dailyLimit = () => Number(process.env.AI_DAILY_LIMIT ?? 60);

/**
 * Запросов к ИИ на всех, кроме владельцев, в день (AI_GLOBAL_DAILY_LIMIT). Ключ
 * Gemini один: регистрация открыта, и чужие аккаунты не должны съесть его квоту.
 */
export const globalDailyLimit = () => Number(process.env.AI_GLOBAL_DAILY_LIMIT ?? 600);

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

/**
 * Учесть запрос в общем дневном лимите; вызывать после takeAiRequest, чтобы отказы
 * по личному лимиту сюда не попадали — иначе один человек долбёжкой исчерпал бы
 * общий за всех. Счётчик — в app_meta, а не суммой ai_usage: строки ai_usage
 * удаляются вместе с аккаунтом, и «завёл, потратил, удалил» обходило бы лимит.
 * День — UTC: общего местного дня у всех нет. Сверх лимита счётчик не растёт.
 */
export async function takeGlobalAiRequest(db: DB, now = new Date(), limit = globalDailyLimit()): Promise<boolean> {
  const [row] = await db
    .insert(appMeta)
    .values({ key: `ai_requests:${todayIn("UTC", now)}`, value: "1" })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: sql`(${appMeta.value}::int + 1)::text`, updatedAt: now },
      setWhere: sql`${appMeta.value}::int < ${limit}`,
    })
    .returning({ value: appMeta.value });
  return row !== undefined && Number(row.value) <= limit;
}
