import { describe, expect, it } from "vitest";
import { shelfWords } from "./words";

describe("shelfWords", () => {
  it("слово в любой форме → как пишут на упаковках", () => {
    expect(shelfWords("сметаны")).toEqual(["sour cream", "crème sure", "թթվասեր"]);
    expect(shelfWords("йогурт", ["fr"])).toEqual(["yogourt", "yaourt"]);
    expect(shelfWords("мёд", ["en"])).toEqual(["honey"]);
  });

  it("нет в словаре — пусто", () => {
    expect(shelfWords("пармезан")).toEqual([]);
  });
});
