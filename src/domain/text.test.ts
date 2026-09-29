import { describe, expect, it } from "vitest";
import { formatInt, plural } from "./text";

describe("formatInt", () => {
  it("разделяет разряды узким пробелом, включая четырёхзначные", () => {
    expect(formatInt(2458)).toBe("2 458");
    expect(formatInt(1234567)).toBe("1 234 567");
    expect(formatInt(620)).toBe("620");
    expect(formatInt(-1500.4)).toBe("−1 500");
  });
});

describe("plural", () => {
  it("склоняет по числу", () => {
    const f: [string, string, string] = ["день", "дня", "дней"];
    expect([1, 2, 5, 11, 21, 22, 25, 112].map((n) => plural(n, f))).toEqual([
      "день", "дня", "дней", "дней", "день", "дня", "дней", "дней",
    ]);
  });
});
