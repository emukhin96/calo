import { apiSession } from "@/lib/api";

/**
 * GET /api/native/token — токен текущей сессии для нативного приложения:
 * WebView вошёл по cookie, а виджету и интентам нужен Bearer (плагин bearer).
 * Отдаётся только своему пользователю и никогда не кэшируется.
 */
export async function GET(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  return Response.json(
    { token: session.session.token, expiresAt: session.session.expiresAt },
    { headers: { "cache-control": "no-store" } },
  );
}
