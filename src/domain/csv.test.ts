import { describe, expect, it } from "vitest";
import { entriesToCsv } from "./csv";

describe("entriesToCsv", () => {
  const csv = entriesToCsv(
    [
      { eatenAt: new Date("2026-09-29T05:30:00Z"), mealName: "Завтрак", title: "Творог 5%", grams: 180, nutrients: { kcal: 217.8, protein: 28.8, vitD: null } },
      { eatenAt: new Date("2026-09-29T20:45:00Z"), mealName: "Ужин", title: 'Паста "Карбонара"; домашняя', grams: 350.5, nutrients: { kcal: 612 } },
      { eatenAt: new Date("2026-09-29T13:10:00Z"), mealName: "Полдник; с кофе", title: "Яблоко", grams: 150, nutrients: { kcal: 78 } },
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

  it("приём пищи — своё название записи", () => {
    expect(lines[3].startsWith('2026-09-29;16:10;"Полдник; с кофе";Яблоко;150;78;')).toBe(true);
  });

  it("дата — день приёма, если он известен", () => {
    const [, row] = entriesToCsv(
      [{ eatenAt: new Date("2026-09-29T21:30:00Z"), date: "2026-09-29", mealName: "Ужин", title: "Чай", grams: 200, nutrients: {} }],
      "Europe/Moscow",
    ).split("\r\n");
    // 00:30 30 сентября по Москве, но приём — 29-го (часовой пояс сменился после записи)
    expect(row.startsWith("2026-09-29;00:30;Ужин;Чай;200;")).toBe(true);
  });

  it("число колонок одинаковое", () => {
    const cols = (l: string) => l.replace(/"[^"]*(""[^"]*)*"/g, "x").split(";").length;
    expect(cols(lines[1])).toBe(cols(lines[0]));
    expect(cols(lines[2])).toBe(cols(lines[0]));
    expect(cols(lines[3])).toBe(cols(lines[0]));
  });
});
