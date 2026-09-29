import { z } from "zod";
import { AiError, aiEnabled, generateJson } from "@/ai/gemini";
import { matchItems, type ParsedItem } from "@/ai/match";
import { parseFoodText } from "@/ai/parse-text";
import { takeAiRequest } from "@/ai/usage";
import { db } from "@/db";
import { todayIn } from "@/domain/day";
import { fastParse } from "@/domain/parse";
import { apiSession } from "@/lib/api";
import { userTimeZone } from "@/lib/tz";

const Body = z.object({ text: z.string().trim().min(1).max(1000) });

export type ParseTextResponse = { items: ParsedItem[]; source: "fast" | "ai" };

const AI_ERROR_RU: Record<AiError["kind"], string> = {
  no_key: "Разбор текста не настроен на сервере.",
  quota: "Квота ИИ на сегодня исчерпана — попробуйте позже или добавьте продукты поиском.",
  blocked: "ИИ отказался разбирать этот текст. Попробуйте переформулировать.",
  bad_response: "ИИ ответил непонятно. Попробуйте ещё раз или добавьте продукты поиском.",
  unavailable: "ИИ сейчас недоступен. Попробуйте позже или добавьте продукты поиском.",
};

/**
 * POST /api/parse/text { text } → { items: [{ name, grams, candidates[3] }], source }.
 * Если у каждой позиции есть явное количество («кефир 250, яйцо 2 шт») — без ИИ.
 * Иначе Gemini даёт список {название, граммы}, matcher подбирает продукты из справочника.
 */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  const ownerId = session.user.id;

  const fast = fastParse(body.data.text);
  if (fast) {
    const items = await matchItems(db, ownerId, fast);
    return Response.json({ items, source: "fast" } satisfies ParseTextResponse);
  }

  if (!aiEnabled()) return Response.json({ error: AI_ERROR_RU.no_key }, { status: 503 });
  const tz = await userTimeZone(ownerId);
  if (!(await takeAiRequest(db, ownerId, todayIn(tz)))) {
    return Response.json({ error: "Дневной лимит запросов к ИИ исчерпан — добавьте продукты поиском." }, { status: 429 });
  }

  try {
    const aiItems = await parseFoodText(body.data.text, generateJson);
    const items = await matchItems(
      db,
      ownerId,
      aiItems.map((i) => ({ ...i, amount: { grams: i.grams } })),
    );
    return Response.json({ items, source: "ai" } satisfies ParseTextResponse);
  } catch (e) {
    if (e instanceof AiError) {
      console.warn(`[ai] ${e.kind}: ${e.message}`);
      return Response.json({ error: AI_ERROR_RU[e.kind] }, { status: e.kind === "quota" ? 429 : 502 });
    }
    throw e;
  }
}
