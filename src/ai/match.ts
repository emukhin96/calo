// Matcher: позиция разбора («сливки 20%», 50 г) → кандидаты из справочника.
// Топ-3 по обычному поиску (db/foods.ts); первый — предложение по умолчанию,
// остальные — выбор на экране подтверждения. Нутриенты считает сервер при записи.
import type { DB } from "@/db";
import { type FoodResult, searchFoods } from "@/db/foods";
import { amountToGrams, type Amount } from "@/domain/amount";
import { queryTokens } from "@/domain/search";

export type ParsedItem = {
  name: string;
  brand: string;
  /** null — штуки без известного веса штуки (продукт не найден или без порции). */
  grams: number | null;
  pieces: number | null;
  state: "raw" | "cooked" | "unknown";
  confidence: number;
  sourceText: string;
  candidates: FoodResult[];
};

export type MatchInput = {
  name: string;
  brand?: string;
  amount: Amount;
  state?: ParsedItem["state"];
  confidence?: number;
  sourceText: string;
};

const TOP = 3;

/**
 * Кандидаты: с брендом → без бренда → по одному слову названия (сначала первое —
 * в русских названиях это обычно сам продукт: «пармезан выдержанный», потом остальные
 * от длинных к коротким). Первое, что не пусто.
 */
export async function findCandidates(db: DB, ownerId: string, name: string, brand = ""): Promise<FoodResult[]> {
  const queries = [brand ? `${name} ${brand}` : "", name];
  const tokens = queryTokens(name);
  if (tokens.length > 1) {
    const [first, ...rest] = tokens;
    queries.push(first, ...rest.sort((a, b) => b.length - a.length));
  }
  for (const q of queries) {
    if (!q) continue;
    const found = await searchFoods(db, ownerId, q, TOP);
    if (found.length) return found;
  }
  return [];
}

export async function matchItems(db: DB, ownerId: string, inputs: MatchInput[]): Promise<ParsedItem[]> {
  return Promise.all(
    inputs.map(async (i) => {
      const candidates = await findCandidates(db, ownerId, i.name, i.brand);
      const pieces = "pieces" in i.amount ? i.amount.pieces : null;
      return {
        name: i.name,
        brand: i.brand ?? "",
        grams: amountToGrams(i.amount, candidates[0]?.defaultPortionG ?? null),
        pieces,
        state: i.state ?? "unknown",
        confidence: i.confidence ?? 1,
        sourceText: i.sourceText,
        candidates,
      };
    }),
  );
}
