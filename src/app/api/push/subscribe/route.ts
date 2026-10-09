import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { apiSession } from "@/lib/api";
import { isPushEndpointAllowed } from "@/lib/push";

/**
 * Подписок на человека. Сверх — удаляем самые старые, а не отказываем: мёртвые
 * подписки чистятся только по 404/410 при отправке, и после смены браузеров отказ
 * сломал бы уведомления на новом устройстве.
 */
const MAX_SUBSCRIPTIONS = 10;

const Sub = z.object({
  endpoint: z.url().max(1000).refine(isPushEndpointAllowed),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** POST /api/push/subscribe — подписка этого браузера (PushSubscription.toJSON()). */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = Sub.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  const { endpoint, keys } = body.data;
  const ownerId = session.user.id;
  await db
    .insert(pushSubscriptions)
    .values({ ownerId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers.get("user-agent") })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { ownerId, p256dh: keys.p256dh, auth: keys.auth },
    });
  const newest = db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.ownerId, ownerId))
    .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
    .limit(MAX_SUBSCRIPTIONS);
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.ownerId, ownerId), notInArray(pushSubscriptions.id, newest)));
  return new Response(null, { status: 204 });
}

/** DELETE /api/push/subscribe { endpoint } — отписка. */
export async function DELETE(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = z.object({ endpoint: z.string().max(1000) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, body.data.endpoint), eq(pushSubscriptions.ownerId, session.user.id)));
  return new Response(null, { status: 204 });
}
