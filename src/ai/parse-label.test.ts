import { describe, expect, it } from "vitest";
import { AiError, type GenerateJson } from "./gemini";
import { LABEL_PROMPT, LABEL_SCHEMA, parseLabel } from "./parse-label";

const image = { mimeType: "image/jpeg" as const, data: "AAAA" };
const fake =
  (answer: unknown): GenerateJson =>
  async () =>
    answer;

const canadian = { found: true, name: "Йогурт греческий 0%", brand: "Oikos", basis: "serving", servingG: 175, kcal: 100, protein: 18, fat: 0, carbs: 7 };

describe("parseLabel", () => {
  it("отдаёт картинку, подсказку и схему; ответ по схеме проходит", async () => {
    let seen: Parameters<GenerateJson>[0] | null = null;
    const r = await parseLabel(image, async (req) => {
      seen = req;
      return canadian;
    });
    expect(r).toMatchObject({ found: true, basis: "serving", servingG: 175, kcal: 100 });
    expect(seen).toMatchObject({ system: LABEL_PROMPT, schema: LABEL_SCHEMA, image });
  });

  it("не хватает калорий или БЖУ — как будто таблицы нет", async () => {
    expect((await parseLabel(image, fake({ ...canadian, kcal: null }))).found).toBe(false);
    expect((await parseLabel(image, fake({ ...canadian, found: false }))).found).toBe(false);
  });

  it("ответ не по схеме — bad_response", async () => {
    await expect(parseLabel(image, fake({ found: true }))).rejects.toBeInstanceOf(AiError);
    await expect(parseLabel(image, fake({ ...canadian, kcal: -5 }))).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("подсказка не даёт придумывать и путать % нормы с граммами", () => {
    expect(LABEL_PROMPT).toMatch(/НЕ придумываешь/);
    expect(LABEL_PROMPT).toMatch(/% DV/);
  });
});
