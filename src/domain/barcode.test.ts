import { describe, expect, it } from "vitest";
import { barcodeVariants, canonicalBarcode, expandUpcE, gtinCheckOk, gtinFromScan, isInStoreCode } from "./barcode";

describe("gtinCheckOk", () => {
  it("EAN-13, UPC-A, EAN-8, GTIN-14", () => {
    expect(gtinCheckOk("4850001261612")).toBe(true); // Marianna, Армения
    expect(gtinCheckOk("068100058925")).toBe(true); // Kraft, Канада, UPC-A
    expect(gtinCheckOk("96385074")).toBe(true);
    expect(gtinCheckOk("04850001261612")).toBe(true);
  });

  it("опечатка в цифре не сходится", () => {
    expect(gtinCheckOk("4850001261613")).toBe(false);
    expect(gtinCheckOk("068100058926")).toBe(false);
  });
});

describe("expandUpcE", () => {
  it("пример из стандарта: 04252614 → 042100005264", () => {
    expect(expandUpcE("04252614")).toBe("042100005264");
  });

  it("все четыре правила по последней цифре", () => {
    expect(expandUpcE("01234505")).toBe("012000003455");
    expect(expandUpcE("01234531")).toBe("012300000451");
    expect(expandUpcE("01234543")).toBe("012340000053");
    expect(expandUpcE("01234558")).toBe("012345000058");
  });

  it("не UPC-E — null", () => {
    expect(expandUpcE("96385074")).toBeNull(); // начинается не с 0/1
    expect(expandUpcE("0425261")).toBeNull();
  });
});

describe("canonicalBarcode", () => {
  it("UPC-A из 12 цифр и он же с нулём — один ключ", () => {
    expect(canonicalBarcode("068100058925")).toBe("0068100058925");
    expect(canonicalBarcode("0068100058925")).toBe("0068100058925");
    expect(canonicalBarcode("00068100058925")).toBe("0068100058925"); // GTIN-14 с индикатором 0
  });

  it("EAN-13 и EAN-8 — как есть", () => {
    expect(canonicalBarcode("4850001261612")).toBe("4850001261612");
    expect(canonicalBarcode("96385074")).toBe("96385074");
  });

  it("UPC-E со сканера разворачивается", () => {
    expect(canonicalBarcode("04252614", { upcE: true })).toBe("0042100005264");
  });

  it("код с несходящейся контрольной цифрой не трогаем", () => {
    expect(canonicalBarcode("99990000980")).toBe("99990000980");
    expect(canonicalBarcode(" 4850-0012-61612 ")).toBe("4850001261612");
  });
});

describe("barcodeVariants", () => {
  it("12 и 13 цифр находят друг друга", () => {
    expect(barcodeVariants("068100058925")).toEqual(expect.arrayContaining(["0068100058925", "068100058925"]));
    expect(barcodeVariants("0068100058925")).toEqual(expect.arrayContaining(["0068100058925", "068100058925"]));
    expect(barcodeVariants("068100058925")[0]).toBe("0068100058925");
  });

  it("восьмизначный — ещё и как UPC-E", () => {
    expect(barcodeVariants("04252614")).toEqual(["04252614", "0042100005264", "042100005264"]);
  });
});

describe("isInStoreCode", () => {
  it("весовые и внутренние коды", () => {
    expect(isInStoreCode("2100100133504")).toBe(true);
    expect(isInStoreCode("4850001261612")).toBe(false);
    expect(isInStoreCode("068100058925")).toBe(false);
  });
});

describe("gtinFromScan", () => {
  it("код маркировки DataMatrix", () => {
    expect(gtinFromScan("0104850001261612215Ab3xYz\u001d93abcd")).toBe("4850001261612");
    expect(gtinFromScan("]d20104850001261612215Ab3xYz")).toBe("4850001261612");
    expect(gtinFromScan("(01)00068100058925(21)123")).toBe("0068100058925");
  });

  it("ссылка GS1 Digital Link", () => {
    expect(gtinFromScan("https://id.gs1.org/01/04850001261612/10/ABC")).toBe("4850001261612");
    expect(gtinFromScan("https://example.com/01/00068100058925")).toBe("0068100058925");
  });

  it("обычный QR — нет товара", () => {
    expect(gtinFromScan("https://calc.egor.am")).toBeNull();
    expect(gtinFromScan("hello")).toBeNull();
  });
});
