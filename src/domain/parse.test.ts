import { describe, expect, it } from "vitest";
import { fastParse } from "./parse";

describe("fastParse", () => {
  it("одна позиция с граммами", () => {
    expect(fastParse("кефир 250")).toEqual([{ name: "кефир", amount: { grams: 250 }, sourceText: "кефир 250" }]);
  });

  it("несколько позиций через запятую и « и »", () => {
    expect(fastParse("творог 5% 180 г, яйцо 2 шт и хлеб 30г")?.map((i) => [i.name, i.amount])).toEqual([
      ["творог 5%", { grams: 180 }],
      ["яйцо", { pieces: 2 }],
      ["хлеб", { grams: 30 }],
    ]);
  });

  it.each([
    "паста со сливками и пармезаном",
    "кефир 250, немного хлеба",
    "250 г",
    "молоко 3,2%",
    "",
    "тарелка борща и два куска хлеба",
  ])("нужен ИИ: %s", (text) => {
    expect(fastParse(text)).toBeNull();
  });
});
