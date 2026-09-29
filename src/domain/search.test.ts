import { describe, expect, it } from "vitest";
import { buildSearchText, normalizeSearch, queryTokens } from "./search";

describe("normalizeSearch", () => {
  it("регистр, ё, пунктуация, десятичная запятая", () => {
    expect(normalizeSearch("Сливки 20%, жирные")).toBe("сливки 20 жирные");
    expect(normalizeSearch("Молоко 3,2%")).toBe("молоко 3.2");
    expect(normalizeSearch("Свёкла, варёная")).toBe("свекла вареная");
  });
});

describe("buildSearchText", () => {
  it("собирает название, синонимы, бренд и английское имя", () => {
    expect(
      buildSearchText({ nameRu: "Сыр пармезан", aliases: ["parmesan"], brand: null, nameEn: "Cheese, parmesan, hard" }),
    ).toBe("сыр пармезан parmesan cheese parmesan hard");
  });
});

describe("queryTokens", () => {
  it("отбрасывает предлоги, единицы и граммы в конце", () => {
    expect(queryTokens("сливки 20")).toEqual(["сливки", "20"]);
    expect(queryTokens("творог 5% 200 г")).toEqual(["творог", "5"]);
    expect(queryTokens("кефир 250")).toEqual(["кефир"]);
    expect(queryTokens("Паста из пармезана")).toEqual(["паста", "пармезана"]);
  });
});
