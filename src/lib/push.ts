import "server-only";
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { profiles, pushSubscriptions } from "@/db/schema";
import { DEFAULT_TZ, isValidTimeZone, isWeeklyDigestTime } from "@/domain/day";
import { lastCompleteWeek, shouldShowWeek } from "./week";

/** Ключи VAPID: на сервере — deploy/vps/gen-vapid.sh, локально — .env.local. */
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

let configured = false;
function configure(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@calc.egor.am", pub, priv);
    configured = true;
  }
  return true;
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

type Sub = typeof pushSubscriptions.$inferSelect;

/** Отправка на одно устройство; мёртвые подписки (404/410) удаляются. */
async function sendTo(sub: Sub, msg: PushMessage): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(msg),
      { TTL: 60 * 60 * 12, urgency: "normal" },
    );
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    else console.error("[push]", status, (e as Error).message);
    return false;
  }
}

export async function sendToUser(ownerId: string, msg: PushMessage): Promise<number> {
  if (!configure()) return 0;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.ownerId, ownerId));
  const results = await Promise.all(subs.map((s) => sendTo(s, msg)));
  return results.filter(Boolean).length;
}

/**
 * Раз в час (cron): в понедельник утром по местному времени — «Разбор недели
 * готов», если в прошлой неделе есть что разбирать и разбор ещё не открывали.
 * Каждой подписке — не больше одного напоминания за неделю.
 */
export async function sendWeeklyDigests(now = new Date()): Promise<{ checked: number; sent: number }> {
  if (!configure()) return { checked: 0, sent: 0 };
  const rows = await db
    .select({ sub: pushSubscriptions, tz: profiles.timezone })
    .from(pushSubscriptions)
    .leftJoin(profiles, eq(profiles.ownerId, pushSubscriptions.ownerId));
  let sent = 0;
  for (const { sub, tz: rawTz } of rows) {
    const tz = isValidTimeZone(rawTz) ? rawTz : DEFAULT_TZ;
    const week = lastCompleteWeek(tz);
    if (!isWeeklyDigestTime(now, tz) || sub.lastWeekNotified === week) continue;
    if (!(await shouldShowWeek(sub.ownerId, tz))) continue;
    const ok = await sendTo(sub, {
      title: "Разбор недели готов",
      body: "Что получилось, на что посмотреть и чем добрать — загляните.",
      url: "/week",
      tag: `week-${week}`,
    });
    if (ok) {
      sent++;
      await db
        .update(pushSubscriptions)
        .set({ lastWeekNotified: week })
        .where(and(eq(pushSubscriptions.id, sub.id)));
    }
  }
  return { checked: rows.length, sent };
}
