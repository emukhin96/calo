// Нормализация текста для поиска продуктов. Одна функция и для индексации
// (foods.search_text), и для запроса — иначе «ё» и регистр разъедутся.

/** «Сливки 20%, жирные» → «сливки 20 жирные». */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(\d),(\d)/g, "$1.$2") // «3,2%» и «3.2» — одно и то же
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/(^|\s)\.|\.(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Текст, по которому ищется продукт: название, синонимы, бренд, английское название. */
export function buildSearchText(f: {
  nameRu: string;
  aliases?: string[] | null;
  brand?: string | null;
  nameEn?: string | null;
}): string {
  return normalizeSearch([f.nameRu, ...(f.aliases ?? []), f.brand ?? "", f.nameEn ?? ""].join(" "));
}

/**
 * Слова запроса. Предлоги и единицы веса отбрасываем: «творог 5% 200 г» ищет
 * «творог 5», а граммы разбирает уже экран добавления.
 */
const STOP = new Set(["и", "с", "со", "в", "на", "из", "без", "г", "гр", "грамм", "мл", "шт", "кг", "л"]);
export function queryTokens(query: string): string[] {
  const tokens = normalizeSearch(query)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
  // Число граммов в конце («кефир 250») — не часть названия, если это не жирность.
  if (tokens.length > 1 && /^\d{3,}$/.test(tokens[tokens.length - 1])) tokens.pop();
  return [...new Set(tokens)].slice(0, 6);
}
