import { describe, expect, it } from "vitest";
import { amountToGrams, parseAmount } from "./amount";

describe("parseAmount", () => {
  it.each([
    ["кефир 250", "кефир", { grams: 250 }],
    ["кефир 250 мл", "кефир", { grams: 250 }],
    ["творог 5% 180 г", "творог 5%", { grams: 180 }],
    ["творог 5% 180г", "творог 5%", { grams: 180 }],
    ["гречка 0,5 кг", "гречка", { grams: 500 }],
    ["молоко 1 л", "молоко", { grams: 1000 }],
    ["яйцо 2 шт", "яйцо", { pieces: 2 }],
    ["яйцо 2 шт.", "яйцо", { pieces: 2 }],
    ["паста 100 грамм", "паста", { grams: 100 }],
  ])("%s", (input, query, amount) => {
    expect(parseAmount(input)).toEqual({ query, amount });
  });

  it.each(["молоко 3,2%", "творог 5", "сливки 20%", "пармезан", "250"])("без количества: %s", (input) => {
    expect(parseAmount(input)).toEqual({ query: input, amount: null });
  });

  it("неправдоподобный вес не считается количеством", () => {
    expect(parseAmount("сыр 99999 г").amount).toBeNull();
  });
});

describe("amountToGrams", () => {
  it("граммы как есть, штуки — через вес штуки", () => {
    expect(amountToGrams({ grams: 150 }, null)).toBe(150);
    expect(amountToGrams({ pieces: 2 }, 55)).toBe(110);
    expect(amountToGrams({ pieces: 2 }, null)).toBeNull();
  });
});
