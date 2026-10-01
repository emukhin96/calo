import { describe, expect, it } from "vitest";
import { HEIGHT_CM, outOfRange, WEIGHT_KG } from "./ranges";

describe("outOfRange", () => {
  it("в пределах и пустое — без подсказки", () => {
    expect(outOfRange(175, ...HEIGHT_CM)).toBe(false);
    expect(outOfRange(120, ...HEIGHT_CM)).toBe(false);
    expect(outOfRange(230, ...HEIGHT_CM)).toBe(false);
    expect(outOfRange(null, ...HEIGHT_CM)).toBe(false);
  });

  it("пока печатают «17» на пути к «175» — молчим", () => {
    expect(outOfRange(1, ...HEIGHT_CM)).toBe(false);
    expect(outOfRange(17, ...HEIGHT_CM)).toBe(false);
    expect(outOfRange(7, ...WEIGHT_KG)).toBe(false);
    expect(outOfRange(199, 1926, 2008)).toBe(false); // год 1990 в процессе
  });

  it("больше максимума или меньше, и цифрами уже не исправить — подсказка", () => {
    expect(outOfRange(231, ...HEIGHT_CM)).toBe(true);
    expect(outOfRange(110, ...HEIGHT_CM)).toBe(true);
    expect(outOfRange(50, ...HEIGHT_CM)).toBe(true); // 500 — уже больше максимума
    expect(outOfRange(17.5, ...HEIGHT_CM)).toBe(true);
    expect(outOfRange(2015, 1926, 2008)).toBe(true); // младше 18
    expect(outOfRange(201, 1926, 2008)).toBe(true); // 2010–2019 — все младше 18
    expect(outOfRange(1900, 1926, 2008)).toBe(true);
  });
});
