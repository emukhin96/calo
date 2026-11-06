import { describe, expect, it } from "vitest";
import { brandAliases, brandEntry, findBrand, translitRu } from "./brands";

describe("findBrand", () => {
  it("кириллица и армянский — бренд с упаковки", () => {
    expect(findBrand("Марианна сметана")).toMatchObject({ brand: { brand: "Marianna" }, rest: "сметана" });
    expect(findBrand("кефир Մարիաննա")).toMatchObject({ brand: { brand: "Marianna" }, rest: "кефир" });
    expect(findBrand("вода джермук")).toMatchObject({ brand: { brand: "Jermuk" }, rest: "вода" });
    expect(findBrand("молоко Натрел 2%")).toMatchObject({ brand: { brand: "Natrel" }, rest: "молоко 2" });
  });

  it("длинное написание раньше короткого: Kraft Dinner, а не Kraft", () => {
    expect(findBrand("крафт диннер")?.brand.brand).toBe("Kraft Dinner");
    expect(findBrand("сыр крафт")?.brand.brand).toBe("Kraft");
    expect(findBrand("аштарак кат мацун")).toMatchObject({ brand: { brand: "Ashtarak Kat" }, rest: "мацун" });
  });

  it("только целыми словами", () => {
    expect(findBrand("ананас")).toBeNull(); // не «Ани»
    expect(findBrand("сметана")).toBeNull();
  });
});

describe("brandEntry / brandAliases", () => {
  it("бренд товара OFF → другие написания", () => {
    expect(brandEntry("marianna")?.brand).toBe("Marianna");
    expect(brandAliases("Marianna")).toEqual(expect.arrayContaining(["Марианна", "Մարիաննա"]));
    expect(brandAliases("Marianna")).not.toContain("Marianna");
    expect(brandAliases("Неизвестный")).toEqual([]);
    expect(brandAliases(null)).toEqual([]);
  });
});

describe("translitRu", () => {
  it("кириллица → латиница", () => {
    expect(translitRu("Натрел")).toBe("natrel");
    expect(translitRu("мацун")).toBe("matsun");
    expect(translitRu("Джермук")).toBe("jermuk");
    expect(translitRu("Сыр Лори")).toBe("syr lori");
  });

  it("без кириллицы — null", () => {
    expect(translitRu("Natrel")).toBeNull();
    expect(translitRu("Մարիաննա")).toBeNull();
  });
});
