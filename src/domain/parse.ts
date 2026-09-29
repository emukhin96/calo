// Быстрый путь разбора текста без ИИ: «кефир 250», «творог 5% 180 г, яйцо 2 шт».
// Если у каждой позиции количество уже указано явно, ИИ не нужен: делим строку
// по запятым и разбираем количества регуляркой (domain/amount.ts).
import { type Amount, parseAmount } from "./amount";

export type FastItem = { name: string; amount: Amount; sourceText: string };

/** Разделители позиций: запятая, точка с запятой, перенос строки, « и », « + ». */
const SPLIT = /[,;\n]+|\s+и\s+|\s+\+\s+/i;

/** Позиции с явным количеством у каждой; null — нужен ИИ. */
export function fastParse(text: string): FastItem[] | null {
  const parts = text
    .split(SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 20) return null;
  const items: FastItem[] = [];
  for (const part of parts) {
    const { query, amount } = parseAmount(part);
    // Название должно остаться и быть похоже на слово: «250 г» без продукта — не позиция.
    if (!amount || query.length < 2 || !/\p{L}/u.test(query)) return null;
    items.push({ name: query, amount, sourceText: part });
  }
  return items;
}
