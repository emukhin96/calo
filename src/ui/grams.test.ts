import { describe, expect, it } from "vitest";
import { formatGrams, holdDelay, parseGrams, sanitizeGrams, sliderMax, stepGrams } from "./grams";

describe("stepGrams", () => {
  it("«+» — к следующему кратному шагу", () => {
    expect(stepGrams(180, 1, 10, 5000)).toBe(190);
    expect(stepGrams(183, 1, 10, 5000)).toBe(190);
    expect(stepGrams(179.9, 1, 10, 5000)).toBe(180);
    expect(stepGrams(2.5, 1, 10, 5000)).toBe(10);
  });

  it("«−» — к предыдущему кратному, не ниже одного шага", () => {
    expect(stepGrams(180, -1, 10, 5000)).toBe(170);
    expect(stepGrams(183, -1, 10, 5000)).toBe(180);
    expect(stepGrams(15, -1, 10, 5000)).toBe(10);
    expect(stepGrams(10, -1, 10, 5000)).toBe(10);
    expect(stepGrams(5, -1, 10, 5000)).toBe(5);
  });

  it("не выходит за максимум", () => {
    expect(stepGrams(4995, 1, 10, 5000)).toBe(5000);
    expect(stepGrams(5000, 1, 10, 5000)).toBe(5000);
  });

  it("дробные шаги без хвостов двоичной арифметики", () => {
    expect(stepGrams(0.3, 1, 0.1, 10)).toBe(0.4);
    expect(stepGrams(0.3, -1, 0.1, 10)).toBe(0.2);
  });
});

describe("ввод граммов текстом", () => {
  it("parseGrams: запятая, точка, пусто, ноль, больше максимума", () => {
    expect(parseGrams("180", 5000)).toBe(180);
    expect(parseGrams("2,5", 5000)).toBe(2.5);
    expect(parseGrams("12.", 5000)).toBe(12);
    expect(parseGrams("1,", 5000)).toBe(1);
    expect(parseGrams("", 5000)).toBeNull();
    expect(parseGrams("0", 5000)).toBeNull();
    expect(parseGrams(",", 5000)).toBeNull();
    expect(parseGrams("0,04", 5000)).toBeNull();
    expect(parseGrams("6000", 5000)).toBe(5000);
  });

  it("sanitizeGrams: цифры и одна запятая, «1,» остаётся как есть", () => {
    expect(sanitizeGrams("1,")).toBe("1,");
    expect(sanitizeGrams("1.")).toBe("1,");
    expect(sanitizeGrams("12,55")).toBe("12,5");
    expect(sanitizeGrams("1,2,3")).toBe("1,2");
    expect(sanitizeGrams("18 0 г")).toBe("180");
    expect(sanitizeGrams("1234567")).toBe("12345");
  });

  it("formatGrams", () => {
    expect(formatGrams(180)).toBe("180");
    expect(formatGrams(2.5)).toBe("2,5");
    expect(formatGrams(1250)).toBe("1250");
    expect(formatGrams(0.1 + 0.2)).toBe("0,3");
  });
});

describe("sliderMax", () => {
  it("начальная шкала: 500 г, 2× вес, 3× порция", () => {
    expect(sliderMax(180, null, null, 5000)).toBe(500);
    expect(sliderMax(310, null, null, 5000)).toBe(700);
    expect(sliderMax(100, 250, null, 5000)).toBe(800);
    expect(sliderMax(4000, null, null, 5000)).toBe(5000);
  });

  it("пока вес внутри шкалы, край не двигается (ползунок не прыгает)", () => {
    expect(sliderMax(450, null, 500, 5000)).toBe(500);
    expect(sliderMax(5, null, 1100, 5000)).toBe(1100);
  });

  it("вес вышел за край — шкала растёт, но не уменьшается", () => {
    expect(sliderMax(510, null, 500, 5000)).toBe(1100);
    expect(sliderMax(3000, null, 5000, 5000)).toBe(5000);
  });
});

describe("holdDelay", () => {
  it("первая пауза длинная, дальше всё чаще, но не чаще 45 мс", () => {
    expect(holdDelay(0)).toBe(400);
    expect(holdDelay(1)).toBe(160);
    const delays = Array.from({ length: 30 }, (_, i) => holdDelay(i + 1));
    expect(delays.every((d, i) => i === 0 || d <= delays[i - 1])).toBe(true);
    expect(Math.min(...delays)).toBe(45);
  });
});
