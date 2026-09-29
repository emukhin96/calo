import { describe, expect, it } from "vitest";
import { entriesToCsv } from "./csv";

describe("entriesToCsv", () => {
  const csv = entriesToCsv(
    [
      { eatenAt: new Date("2026-09-29T05:30:00Z"), meal: "breakfast", title: "Творог 5%", grams: 180, nutrients: { kcal: 217.8, protein: 28.8, vitD: null } },
      { eatenAt: new Date("2026-09-29T20:45:00Z"), meal: "dinner", title: 'Паста "Карбонара"; домашняя', grams: 350.5, nutrients: { kcal: 612 } },
    ],
    "Europe/Moscow",
  );
  const lines = csv.split("\r\n");

  it("BOM, заголовок с единицами, разделитель «;»", () => {
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toContain("Дата;Время;Приём пищи;Продукт;Граммы;Ккал;Белки, г;");
    expect(lines[0]).toContain("Витамин D, мкг");
  });

  it("местное время, десятичная запятая, пустое — для неизвестного", () => {
    expect(lines[1].startsWith("2026-09-29;08:30;Завтрак;Творог 5%;180;217,8;28,8;")).toBe(true);
    // 20:45 UTC — 23:45 в Москве, тот же день
    expect(lines[2].startsWith('2026-09-29;23:45;Ужин;"Паста ""Карбонара""; домашняя";350,5;612;')).toBe(true);
  });

  it("число колонок одинаковое", () => {
    const cols = (l: string) => l.replace(/"[^"]*(""[^"]*)*"/g, "x").split(";").length;
    expect(cols(lines[1])).toBe(cols(lines[0]));
    expect(cols(lines[2])).toBe(cols(lines[0]));
  });
});
