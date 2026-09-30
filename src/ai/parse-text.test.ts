import { describe, expect, it } from "vitest";
import { AiError, type GenerateJson } from "./gemini";
import { AI_RESULT_SCHEMA, parseFoodText, SYSTEM_PROMPT } from "./parse-text";

const fake =
  (answer: unknown): GenerateJson =>
  async () =>
    answer;

describe("parseFoodText", () => {
  it("принимает ответ по схеме и округляет граммы", async () => {
    const items = await parseFoodText(
      "паста со сливками",
      fake({
        items: [
          { name: "паста", brand: "", grams: 99.6, state: "raw", confidence: 0.9, sourceText: "паста" },
          { name: "сливки 20%", brand: "", grams: 50, state: "unknown", confidence: 0.7, sourceText: "сливками" },
        ],
      }),
    );
    expect(items.map((i) => [i.name, i.grams])).toEqual([
      ["паста", 100],
      ["сливки 20%", 50],
    ]);
  });

  it("английское название — необязательное: старые ответы без него проходят, лишнее обрезается", async () => {
    const base = { brand: "", grams: 100, state: "raw", confidence: 1, sourceText: "" };
    const items = await parseFoodText(
      "x",
      fake({
        items: [
          { ...base, name: "паста", nameEn: " pasta, dry " },
          { ...base, name: "сливки 20%" },
          { ...base, name: "сыр", nameEn: "x".repeat(200) },
          { ...base, name: "мёд", nameEn: null },
        ],
      }),
    );
    expect(items.map((i) => i.nameEn)).toEqual(["pasta, dry", "", "x".repeat(80), ""]);
  });

  it("схема просит у ИИ английское название, промпт объясняет зачем", () => {
    const item = (AI_RESULT_SCHEMA.properties as { items: { items: { properties: object; required: string[] } } }).items.items;
    expect(item.properties).toHaveProperty("nameEn");
    expect(item.required).toContain("nameEn");
    expect(SYSTEM_PROMPT).toMatch(/nameEn/);
  });

  it("отклоняет ответ не по схеме", async () => {
    await expect(parseFoodText("x", fake({ items: [{ name: "паста" }] }))).rejects.toBeInstanceOf(AiError);
    await expect(parseFoodText("x", fake({ items: [{ name: "паста", brand: "", grams: 0, state: "raw", confidence: 1, sourceText: "" }] }))).rejects.toMatchObject({ kind: "bad_response" });
    await expect(parseFoodText("x", fake("не json"))).rejects.toBeInstanceOf(AiError);
  });

  it("передаёт ИИ системный промпт, схему и обрезанный текст", async () => {
    let seen: Parameters<GenerateJson>[0] | null = null;
    await parseFoodText("  кефир 250  ", async (req) => {
      seen = req;
      return { items: [] };
    });
    expect(seen).toMatchObject({ system: SYSTEM_PROMPT, user: "кефир 250", schema: AI_RESULT_SCHEMA });
  });

  it("промпт запрещает ИИ считать нутриенты", () => {
    expect(SYSTEM_PROMPT).toMatch(/НЕ оцениваешь калории/);
  });
});
