// Штрихкоды товаров (GTIN): один товар — один ключ, как бы его ни прочитали.
// UPC-A из Канады и США сканер отдаёт то 12 цифрами, то 13 с нулём впереди;
// маленькие пачки (жвачка, батончики) несут сжатый UPC-E из 8 цифр; коды
// маркировки (DataMatrix «Честного знака», QR GS1 Digital Link) содержат GTIN-14.
// Open Food Facts хранит UPC-A как 13 цифр с нулём впереди — так и храним мы.

/** Цифр в коде, который принимают API и форма своего продукта. */
export const BARCODE_RE = /^\d{8,14}$/;

/** Контрольная цифра GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) сходится. */
export function gtinCheckOk(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  let sum = 0;
  for (let i = code.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(code[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/**
 * UPC-E (8 цифр: система 0/1, 6 цифр, контрольная) → UPC-A (12 цифр).
 * null — не UPC-E. Контрольная цифра у обоих одна.
 */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, check] = code;
  const body =
    d6 <= "2"
      ? `${d1}${d2}${d6}0000${d3}${d4}${d5}`
      : d6 === "3"
        ? `${d1}${d2}${d3}00000${d4}${d5}`
        : d6 === "4"
          ? `${d1}${d2}${d3}${d4}00000${d5}`
          : `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  const upcA = ns + body + check;
  return gtinCheckOk(upcA) ? upcA : null;
}

/**
 * Ключ товара: EAN-8 — 8 цифр, остальное — 13 (UPC-A с нулём впереди, GTIN-14
 * с индикатором 0 — без него); GTIN-14 упаковки (индикатор 1–8) — 14.
 * upcE — сканер сказал, что это UPC-E: разворачиваем в UPC-A.
 * Код с несходящейся контрольной цифрой не трогаем: в Open Food Facts такие
 * тоже бывают, а нули впереди у них ничего не значат.
 */
export function canonicalBarcode(raw: string, opts: { upcE?: boolean } = {}): string {
  const digits = raw.replace(/\D/g, "");
  if (opts.upcE) {
    const upcA = expandUpcE(digits);
    if (upcA) return "0" + upcA;
  }
  if (!gtinCheckOk(digits)) return digits;
  if (digits.length === 8) return digits;
  if (digits.length === 14) return digits.startsWith("0") ? digits.slice(1) : digits;
  return digits.padStart(13, "0");
}

/**
 * Все написания кода, под которыми товар мог сохраниться раньше: ключ, как
 * ввели, UPC-A из 12 цифр, GTIN-14; восьмизначный — ещё и развёрнутый UPC-E
 * (вручную введённый код не скажет, EAN-8 это или UPC-E). Первый — ключ.
 */
export function barcodeVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  const key = canonicalBarcode(digits);
  const out = [key, digits];
  if (key.length === 13) {
    if (key.startsWith("0")) out.push(key.slice(1));
    out.push("0" + key);
  }
  if (digits.length === 8) {
    const upcA = expandUpcE(digits);
    if (upcA) out.push("0" + upcA, upcA);
  }
  return [...new Set(out)].filter((c) => BARCODE_RE.test(c));
}

/**
 * Внутренний код магазина: весовой товар или своя маркировка (префиксы GS1
 * 20–29, UPC с системой 2 и 4). В нём бывают вес или цена — в базах товаров
 * его не найти, а у другого магазина тот же код — другой товар.
 */
export function isInStoreCode(raw: string): boolean {
  const key = canonicalBarcode(raw);
  return key.length === 13 && (/^2/.test(key) || /^0[24]/.test(key));
}

/**
 * GTIN из текста двумерного кода: элемент (01) кода маркировки («Честный знак»:
 * 01 04607004012044 21 …, с ]d2 или скобками) или ссылка GS1 Digital Link
 * (https://…/01/04607004012044/…). null — товарного кода в нём нет.
 */
export function gtinFromScan(text: string): string | null {
  const s = text.trim();
  const link = s.match(/\/01\/(\d{14})(?:[/?#]|$)/);
  if (link) return canonicalBarcode(link[1]);
  const element = s.replace(/^\]d2|^\]Q3|^\]C1/, "").match(/^\(?01\)?(\d{14})/);
  if (element && gtinCheckOk(element[1])) return canonicalBarcode(element[1]);
  return null;
}
