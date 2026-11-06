import { describe, expect, it } from "vitest";
import { shopCountry } from "./country";

describe("shopCountry", () => {
  it("пояс телефона → страна полок и язык упаковок", () => {
    expect(shopCountry("Asia/Yerevan")).toEqual({ tag: "armenia", langs: ["hy"] });
    expect(shopCountry("America/Toronto")).toEqual({ tag: "canada", langs: ["fr"] });
    expect(shopCountry("America/Vancouver")?.tag).toBe("canada");
    expect(shopCountry("Canada/Eastern")?.tag).toBe("canada");
    expect(shopCountry("Europe/Moscow")?.tag).toBe("russia");
  });

  it("не сопоставленный пояс — без предпочтения страны", () => {
    expect(shopCountry("America/New_York")).toBeNull();
    expect(shopCountry(null)).toBeNull();
  });
});
