// Слова с полки на языках упаковок: «сметана» — «sour cream», «crème sure»,
// «թթվասեր». Армянские товары в Open Food Facts чаще подписаны по-английски, а
// канадские — по-французски; без перевода русский запрос их не находит.
// Словарь — seed/foods/words.json, правится руками.
import WORDS from "../../seed/foods/words.json";
import { normalizeSearch, sameWord } from "./search";

export type ShelfLang = "en" | "fr" | "hy";
type Entry = Partial<Record<ShelfLang, string[]>>;

const DICT = Object.entries(WORDS as Record<string, Entry | string>)
  .filter((e): e is [string, Entry] => typeof e[1] === "object")
  .map(([word, entry]) => [normalizeSearch(word), entry] as const);

/**
 * Переводы слова запроса в любой форме («сметаны» → «sour cream», «crème sure»…),
 * по языкам в порядке langs. Нет в словаре — пусто.
 */
export function shelfWords(token: string, langs: ShelfLang[] = ["en", "fr", "hy"]): string[] {
  const t = normalizeSearch(token);
  const hit = DICT.find(([word]) => sameWord(t, word));
  return hit ? langs.flatMap((l) => hit[1][l] ?? []) : [];
}
