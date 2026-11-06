import { describe, expect, it } from "vitest";
import { AiError, type GenerateJson } from "./gemini";
import { isRussianName, NAME_PROMPT, NAME_SCHEMA, translateFoodName } from "./translate-name";

describe("translateFoodName", () => {
  it("отдаёт название с брендом и схему; ответ по схеме проходит", async () => {
    let seen: Parameters<GenerateJson>[0] | null = null;
    const r = await translateFoodName("Lori brine cheese", "Marianna", async (req) => {
      seen = req;
      return { nameRu: "Сыр Лори рассольный", aliases: ["сыр лори"] };
    });
    expect(r).toEqual({ nameRu: "Сыр Лори рассольный", aliases: ["сыр лори"] });
    expect(seen).toMatchObject({ system: NAME_PROMPT, schema: NAME_SCHEMA, user: "Lori brine cheese\nБренд: Marianna" });
  });

  it("ответ не по схеме — bad_response", async () => {
    await expect(translateFoodName("x", null, async () => ({ nameRu: "" }))).rejects.toBeInstanceOf(AiError);
  });

  it("кириллица — уже по-русски", () => {
    expect(isRussianName("Мацун")).toBe(true);
    expect(isRussianName("Matsun 3.2%")).toBe(false);
    expect(isRussianName("Մածուն")).toBe(false);
  });
});
