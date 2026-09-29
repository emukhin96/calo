// Разбор количества из строки ввода: «кефир 250», «творог 5% 180 г», «яйцо 2 шт».
// Жирность («5%», «3,2%») количеством не считается.

export type Amount = { grams: number } | { pieces: number };

const UNIT = String.raw`(кг|килограмм\w*|г|гр|грамм\w*|мл|л|литр\w*|шт|штук\w*)`;
const TAIL = new RegExp(String.raw`(?:^|\s)(\d+(?:[.,]\d+)?)\s*${UNIT}?\.?\s*$`, "i");

/**
 * Количество в конце строки и строка без него.
 * «кефир 250» → { query: "кефир", amount: { grams: 250 } }
 * «молоко 3,2%» → { query: "молоко 3,2%", amount: null } — это жирность.
 */
export function parseAmount(input: string): { query: string; amount: Amount | null } {
  const text = input.trim();
  const m = text.match(TAIL);
  if (!m) return { query: text, amount: null };
  const value = Number(m[1].replace(",", "."));
  const unit = (m[2] ?? "").toLowerCase();
  const query = text.slice(0, m.index).trim();
  // Одиночное число без единицы — граммы, только если оно правдоподобно как вес
  // и перед ним есть название («кефир 250»); «творог 5» — это жирность.
  if (!unit && (value < 10 || !query)) return { query: text, amount: null };
  if (!(value > 0) || value > 5000) return { query: text, amount: null };

  if (unit.startsWith("кг") || unit.startsWith("килограмм")) return { query, amount: { grams: value * 1000 } };
  if (unit === "л" || unit.startsWith("литр")) return { query, amount: { grams: value * 1000 } }; // мл ≈ г
  if (unit.startsWith("шт")) return { query, amount: { pieces: value } };
  return { query, amount: { grams: value } };
}

/** Граммы из количества; для штук нужен вес одной штуки. */
export function amountToGrams(amount: Amount, pieceGrams: number | null): number | null {
  if ("grams" in amount) return amount.grams;
  return pieceGrams ? amount.pieces * pieceGrams : null;
}
