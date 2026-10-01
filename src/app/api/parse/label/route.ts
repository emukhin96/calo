import { z } from "zod";
import { AiError, aiEnabled, generateJson } from "@/ai/gemini";
import { type LabelResult, parseLabel } from "@/ai/parse-label";
import { takeAiRequest } from "@/ai/usage";
import { db } from "@/db";
import { todayIn } from "@/domain/day";
import { apiSession } from "@/lib/api";
import { userTimeZone } from "@/lib/tz";

/** Сжатое на клиенте фото (ui/image.ts) — сотни килобайт; больше 4 МБ base64 не ждём. */
const Body = z.object({
  image: z.string().min(100).max(4_000_000).regex(/^[A-Za-z0-9+/=]+$/),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
});

export type ParseLabelResponse = LabelResult;

const AI_ERROR_RU: Record<AiError["kind"], string> = {
  no_key: "Чтение этикеток не настроено на сервере.",
  quota: "Квота ИИ на сегодня исчерпана — перепишите цифры вручную.",
  blocked: "ИИ отказался читать это фото. Попробуйте ещё раз.",
  bad_response: "ИИ ответил непонятно. Попробуйте ещё раз или перепишите цифры вручную.",
  unavailable: "ИИ сейчас недоступен. Перепишите цифры вручную или попробуйте позже.",
};

/**
 * POST /api/parse/label { image: base64 JPEG, mimeType? } → цифры с этикетки
 * (src/ai/parse-label.ts) для формы своего продукта. 422 — таблицы пищевой
 * ценности на фото не видно. Считается в дневной лимит ИИ, как разбор текста.
 */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request" }, { status: 400 });
  if (!aiEnabled()) return Response.json({ error: AI_ERROR_RU.no_key }, { status: 503 });

  const ownerId = session.user.id;
  if (!(await takeAiRequest(db, ownerId, todayIn(await userTimeZone(ownerId))))) {
    return Response.json({ error: "Дневной лимит запросов к ИИ исчерпан — перепишите цифры вручную." }, { status: 429 });
  }
  try {
    const result = await parseLabel({ mimeType: body.data.mimeType, data: body.data.image }, generateJson);
    if (!result.found) {
      return Response.json({ error: "Не вижу таблицу пищевой ценности — сфотографируйте её ближе и ровнее." }, { status: 422 });
    }
    return Response.json(result satisfies ParseLabelResponse);
  } catch (e) {
    if (e instanceof AiError) {
      console.warn(`[ai] label ${e.kind}: ${e.message}`);
      return Response.json({ error: AI_ERROR_RU[e.kind] }, { status: e.kind === "quota" ? 429 : 502 });
    }
    throw e;
  }
}
