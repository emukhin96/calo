import "server-only";

/**
 * Клиент Gemini API (generateContent) со строгим JSON-ответом по схеме.
 * Ключ — GEMINI_API_KEY из /opt/calc/.env (deploy/vps/set-secret.sh); модель —
 * GEMINI_MODEL, по умолчанию быстрая lite-модель (~3 с на разбор строки).
 * ИИ никогда не считает нутриенты — только превращает текст в список позиций
 * или переписывает цифры с фото этикетки (их проверяет человек).
 */

export type AiErrorKind = "no_key" | "quota" | "blocked" | "bad_response" | "unavailable";

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export type JsonSchema = Record<string, unknown>;

/** Картинка к запросу: JPEG/PNG в base64 (фото этикетки). */
export type AiImage = { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string };

export type GenerateJson = (req: { system: string; user: string; schema: JsonSchema; image?: AiImage }) => Promise<unknown>;

// 3.1-flash-lite: ~3 с на разбор строки; 3.5-flash-lite на тех же запросах отдавал 11–14 с,
// 3.5-flash тратит ~1300 токенов на размышления (25 с), 3.8-flash часто отвечает 503 (перегрузка).
export const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export const aiEnabled = () => Boolean(process.env.GEMINI_API_KEY);

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/** Один запрос к Gemini; 429/5xx — одна повторная попытка через секунду. */
export const generateJson: GenerateJson = async ({ system, user, schema, image }) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("no_key", "GEMINI_API_KEY не задан");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }, ...(image ? [{ inlineData: image }] : [])] }],
    generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseJsonSchema: schema },
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000));
    try {
      res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      if (attempt) throw new AiError("unavailable", `Gemini недоступен: ${(e as Error).message}`);
      continue;
    }
    if (res.status !== 429 && res.status < 500) break;
  }
  if (!res) throw new AiError("unavailable", "Gemini недоступен");

  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (res.status === 429) throw new AiError("quota", "квота Gemini исчерпана");
  if (!res.ok) throw new AiError("unavailable", `Gemini HTTP ${res.status}: ${data.error?.message ?? ""}`);
  if (data.promptFeedback?.blockReason) throw new AiError("blocked", `запрос отклонён: ${data.promptFeedback.blockReason}`);

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("bad_response", "Gemini вернул не JSON");
  }
};
