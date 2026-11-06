// Бренды с полки: как их пишут на упаковке (латиница), по-русски и по-армянски.
// В Open Food Facts «Марианна» — это майонез из России, а армянская молочка —
// «Marianna»; «Джермук» там не находится вовсе. Словарь — seed/foods/brands.json,
// правится руками; для брендов не из словаря — транслитерация (translitRu).
import BRANDS from "../../seed/foods/brands.json";
import { normalizeSearch } from "./search";

export type Brand = { brand: string; aliases: string[]; countries?: string[] };

const LIST = BRANDS as Brand[];

const words = (s: string) => normalizeSearch(s).split(" ").filter(Boolean);

type Entry = { brand: Brand; words: string[] };
/** Все написания всех брендов, длинные сначала: «Kraft Dinner» раньше «Kraft». */
const ENTRIES: Entry[] = LIST.flatMap((b) => [b.brand, ...b.aliases].map((a) => ({ brand: b, words: words(a) })))
  .filter((e) => e.words.length > 0)
  .sort((a, b) => b.words.length - a.words.length);

/**
 * Бренд из словаря в запросе: «марианна сметана» → Marianna и «сметана».
 * Совпадение — целыми словами подряд, в любом месте запроса.
 */
export function findBrand(query: string): { brand: Brand; rest: string } | null {
  const q = words(query);
  for (const e of ENTRIES) {
    for (let i = 0; i + e.words.length <= q.length; i++) {
      if (e.words.every((w, j) => q[i + j] === w)) {
        return { brand: e.brand, rest: [...q.slice(0, i), ...q.slice(i + e.words.length)].join(" ") };
      }
    }
  }
  return null;
}

/** Бренд товара (как в Open Food Facts: «Marianna», «marianna, Dustr») → запись словаря. */
export function brandEntry(brand: string | null | undefined): Brand | null {
  if (!brand) return null;
  const b = words(brand.split(",")[0] ?? "").join(" ");
  if (!b) return null;
  return ENTRIES.find((e) => e.words.join(" ") === b)?.brand ?? null;
}

/** Другие написания бренда — синонимы товара: «марианна» находит сохранённую «Marianna». */
export function brandAliases(brand: string | null | undefined): string[] {
  const entry = brandEntry(brand);
  return entry ? [entry.brand, ...entry.aliases].filter((a) => normalizeSearch(a) !== normalizeSearch(brand ?? "")) : [];
}

const RU_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Кириллица → латиница для поиска товаров с латинскими названиями: «натрел» →
 * «natrel», «мацун» → «matsun». «Дж» — j, как пишут армянские и грузинские
 * названия (Джермук — Jermuk). null — в тексте нет кириллицы.
 */
export function translitRu(text: string): string | null {
  const s = normalizeSearch(text);
  if (!/[а-я]/.test(s)) return null;
  return s.replace(/дж/g, "j").replace(/[а-я]/g, (c) => RU_LAT[c] ?? c);
}
