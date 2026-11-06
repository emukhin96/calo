import { describe, expect, it } from "vitest";
import { barcodeNotFoundNote, kcalMismatch, type OwnFoodInput, ownFoodErrors, per100FromServing, servingError } from "./own-food";

const yogurt: OwnFoodInput = {
  nameRu: "Йогурт греческий 2%",
  brand: "Epica",
  barcode: "4640003390225",
  per100g: { kcal: 66, protein: 8.2, fat: 2, carbs: 3.9 },
  defaultPortionG: 130,
};

describe("ownFoodErrors", () => {
  it("правильный продукт без ошибок, необязательные поля можно не заполнять", () => {
    expect(ownFoodErrors(yogurt)).toEqual({});
    expect(ownFoodErrors({ ...yogurt, brand: null, barcode: null, defaultPortionG: null })).toEqual({});
    expect(ownFoodErrors({ ...yogurt, brand: "", barcode: "" })).toEqual({});
  });

  it("название обязательно", () => {
    expect(ownFoodErrors({ ...yogurt, nameRu: "   " }).nameRu).toBeTruthy();
  });

  it("штрихкод — только 8–14 цифр", () => {
    expect(ownFoodErrors({ ...yogurt, barcode: "1234567" }).barcode).toBeTruthy();
    expect(ownFoodErrors({ ...yogurt, barcode: "46400033902a4" }).barcode).toBeTruthy();
    expect(ownFoodErrors({ ...yogurt, barcode: "96385074" }).barcode).toBeUndefined();
    expect(ownFoodErrors({ ...yogurt, barcode: "068100058925" }).barcode).toBeUndefined(); // UPC-A, Канада
    // опечатка: контрольная цифра не сходится
    expect(ownFoodErrors({ ...yogurt, barcode: "12345678" }).barcode).toMatch(/контрольная/);
    expect(ownFoodErrors({ ...yogurt, barcode: "4640003390224" }).barcode).toMatch(/контрольная/);
  });

  it("КБЖУ: пусто, отрицательно и больше разумного — ошибки", () => {
    const e = ownFoodErrors({ ...yogurt, per100g: { kcal: NaN, protein: -1, fat: 101, carbs: 3 } });
    expect(e.kcal).toBe("Нужно число");
    expect(e.protein).toBeTruthy();
    expect(e.fat).toBeTruthy();
    expect(e.carbs).toBeUndefined();
    expect(ownFoodErrors({ ...yogurt, per100g: { ...yogurt.per100g, kcal: 950 } }).kcal).toBeTruthy();
  });

  it("масло: 99,9 г жира проходит, Б + Ж + У больше 105 — нет", () => {
    expect(ownFoodErrors({ ...yogurt, per100g: { kcal: 899, protein: 0, fat: 99.9, carbs: 0 } })).toEqual({});
    expect(ownFoodErrors({ ...yogurt, per100g: { kcal: 400, protein: 40, fat: 30, carbs: 40 } }).macros).toMatch(/100 г/);
  });

  it("порция — от 1 г (как в подсказке): иначе кнопка «порция 0 г»", () => {
    expect(ownFoodErrors({ ...yogurt, defaultPortionG: 0 }).defaultPortionG).toBeTruthy();
    expect(ownFoodErrors({ ...yogurt, defaultPortionG: 0.01 }).defaultPortionG).toBeTruthy();
    expect(ownFoodErrors({ ...yogurt, defaultPortionG: NaN }).defaultPortionG).toBeTruthy();
    expect(ownFoodErrors({ ...yogurt, defaultPortionG: 1 }).defaultPortionG).toBeUndefined();
    expect(ownFoodErrors({ ...yogurt, defaultPortionG: 12.5 }).defaultPortionG).toBeUndefined();
  });
});

describe("kcalMismatch", () => {
  it("сходящаяся этикетка — без подсказки", () => {
    expect(kcalMismatch(yogurt.per100g)).toBeNull();
  });

  it("опечатка в калориях — подсказывает, сколько выходит по БЖУ", () => {
    expect(kcalMismatch({ kcal: 660, protein: 8.2, fat: 2, carbs: 3.9 })).toBe(66);
  });

  it("не всё заполнено — молчит", () => {
    expect(kcalMismatch({ kcal: 100, protein: NaN, fat: 1, carbs: 1 })).toBeNull();
  });
});

describe("barcodeNotFoundNote", () => {
  it("внутренний код магазина — своё пояснение", () => {
    expect(barcodeNotFoundNote("2100100133504")).toMatch(/внутренний код магазина/);
    expect(barcodeNotFoundNote("4850001261612")).toMatch(/нет в Open Food Facts/);
  });
});

describe("per100FromServing", () => {
  it("канадская этикетка: на 1 cup (250 mL) → на 100 г", () => {
    expect(per100FromServing({ kcal: 110, protein: 9, fat: 2.5, carbs: 13 }, 250)).toEqual({ kcal: 44, protein: 3.6, fat: 1, carbs: 5.2 });
    expect(per100FromServing({ kcal: 100, protein: 1, fat: 4, carbs: 15 }, 22)).toEqual({ kcal: 454.5, protein: 4.5, fat: 18.2, carbs: 68.2 });
  });

  it("пустые поля и нет порции — NaN, форма покажет «нужно число»", () => {
    const r = per100FromServing({ kcal: NaN, protein: 1, fat: 1, carbs: 1 }, 30);
    expect(r.kcal).toBeNaN();
    expect(per100FromServing({ kcal: 100, protein: 1, fat: 1, carbs: 1 }, NaN).kcal).toBeNaN();
    expect(servingError(NaN)).toBeTruthy();
    expect(servingError(0)).toBeTruthy();
    expect(servingError(250)).toBeUndefined();
  });
});
