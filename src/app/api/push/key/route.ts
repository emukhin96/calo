import { vapidPublicKey } from "@/lib/push";

/** GET /api/push/key — публичный ключ VAPID для подписки в браузере. */
export function GET() {
  const key = vapidPublicKey();
  return key ? Response.json({ key }) : Response.json({ error: "push not configured" }, { status: 503 });
}
