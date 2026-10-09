import "server-only";
import { parse as parseLegacyUrl } from "node:url";
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

/** Обычное DNS-имя: метки из букв, цифр и дефисов через точку, без точки на конце. */
const DNS_HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Адрес подписки — только https на известных push-сервисах браузеров: иначе любой
 * пользователь заставит сервер слать запросы куда угодно (SSRF).
 * Chrome, Opera, Яндекс и т. п. — FCM, Edge — WNS, Safari — Apple, Firefox — Mozilla.
 */
export function isPushEndpointAllowed(endpoint: string): boolean {
  // Браузеры отдают адрес печатным ASCII; пробелы, управляющие символы и юникод
  // парсеры URL толкуют по-разному — такой адрес не нужен.
  if (!/^[\x21-\x7e]+$/.test(endpoint)) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  const host = url.hostname; // URL уже привёл к нижнему регистру
  if (!DNS_HOSTNAME.test(host)) return false;
  // web-push 3.6 соединяется по старому url.parse(), а тот обрезает имя на ; ' { " и т. п.:
  // «localhost;.push.apple.com» прошёл бы список, а запрос ушёл бы на localhost.
  // Пускаем, только если старый парсер видит тот же хост и порт по умолчанию.
  let legacy: ReturnType<typeof parseLegacyUrl>;
  try {
    legacy = parseLegacyUrl(endpoint);
  } catch {
    return false;
  }
  if (legacy.hostname !== host || (legacy.port !== null && legacy.port !== "443")) return false;
  return (
    host === "fcm.googleapis.com" ||
    host.endsWith(".push.apple.com") ||
    host.endsWith(".push.services.mozilla.com") ||
    host.endsWith(".notify.windows.com")
  );
}

/** Зависший push-сервис не должен держать рассылку: таймаут сокета, мс. */
const SEND_TIMEOUT_MS = 10_000;
/** Сколько отправок разбора недели одновременно — по размеру пула БД. */
const DIGEST_CONCURRENCY = 5;

type Sub = typeof pushSubscriptions.$inferSelect;

/** Отправка на одно устройство; мёртвые подписки (404/410) удаляются. */
async function sendTo(sub: Sub, msg: PushMessage): Promise<boolean> {
  // Подписки, сохранённые до проверки адреса, — тоже не дальше списка.
  if (!isPushEndpointAllowed(sub.endpoint)) return false;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(msg),
      { TTL: 60 * 60 * 12, urgency: "normal", timeout: SEND_TIMEOUT_MS },
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
  const due = rows.flatMap(({ sub, tz: rawTz }) => {
    const tz = isValidTimeZone(rawTz) ? rawTz : DEFAULT_TZ;
    const week = lastCompleteWeek(tz);
    return isWeeklyDigestTime(now, tz) && sub.lastWeekNotified !== week ? [{ sub, tz, week }] : [];
  });
  let sent = 0;
  // Не по одной: медленный push-сервис одного человека не задерживает остальных.
  await eachLimited(due, DIGEST_CONCURRENCY, async ({ sub, tz, week }) => {
    if (!(await shouldShowWeek(sub.ownerId, tz))) return;
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
  });
  return { checked: rows.length, sent };
}

/** fn для каждого элемента, не больше limit одновременно. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
