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

// Окончания прилагательных и существительных, от длинных к коротким.
const ENDINGS = [
  "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими",
  "ой", "ый", "ий", "ая", "яя", "ое", "ее", "ые", "ие", "ую", "юю", "ом", "ем", "ым", "им", "ых", "их", "ов", "ев", "ей",
  "а", "я", "о", "е", "и", "ы", "у", "ю", "ь", "й",
];

/**
 * Лёгкий стемминг для поиска подстрокой: «сырой» и «сырые» → «сыр»,
 * «яблоко» → «яблок», «варёный» → «варен». Слова короче 5 букв и не
 * кириллица не трогаем («сыр», «rummo», «20»).
 */
export function stem(token: string): string {
  if (token.length < 5 || !/^[а-я]+$/.test(token)) return token;
  for (const e of ENDINGS) {
    if (token.endsWith(e) && token.length - e.length >= 3) return token.slice(0, -e.length);
  }
  return token;
}
