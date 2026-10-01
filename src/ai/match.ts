// Matcher: позиция разбора («сливки 20%», 50 г) → кандидаты из справочника.
// Топ-3 по обычному поиску (db/foods.ts); первый — предложение по умолчанию,
// остальные — выбор на экране подтверждения. Нутриенты считает сервер при записи.
import type { DB } from "@/db";
import { type FoodHit, type FoodResult, searchFoods } from "@/db/foods";
import { type RecipeSummary, searchRecipes } from "@/db/recipes";
import { amountToGrams, type Amount } from "@/domain/amount";
import { type MatchKind, matchFood, parseQuery, queryTokens } from "@/domain/search";

/**
 * Кандидат позиции. match — как совпал с названием (db/foods.ts searchFoods):
 * partial — не всеми словами («оливье» → «Масло оливковое»), такой не выбирается
 * сам. У продукта из «другой…» match нет — его выбрал человек. recipeId — это
 * своё блюдо из «Блюд» (id тогда `recipe:<id>`): запись — с recipeId, а не foodId.
 */
export type Candidate = FoodResult & { match?: MatchKind; recipeId?: string };

/** Своё блюдо как кандидат позиции: те же поля, что у продукта справочника. */
function recipeCandidate(r: RecipeSummary, match: MatchKind): Candidate {
  const portion = r.defaultPortionG ? Math.round(r.defaultPortionG) : null;
  return {
    id: `recipe:${r.id}`,
    recipeId: r.id,
    nameRu: r.name,
    brand: null,
    source: "manual",
    sourceRef: null,
    own: true,
    nutrientsPer100g: r.nutrientsPer100g,
    defaultPortionG: r.defaultPortionG,
    portionLabel: portion ? `порция ${portion} г` : null,
    match,
  };
}

/**
 * Свои блюда с этим названием целыми словами («борщ» → «Борщ мамин»): их человек
 * собрал сам, они точнее общего борща из справочника — поэтому первыми.
 */
async function ownDishes(db: DB, ownerId: string, name: string): Promise<Candidate[]> {
  const q = parseQuery(name);
  if (q.tokens.length === 0) return [];
  const found = await searchRecipes(db, ownerId, q.tokens.map((t) => (t.length > 4 ? t.slice(0, -1) : t)), 5);
  return found
    .map((r) => ({ r, m: matchFood(q, { nameRu: r.name }) }))
    .filter(({ m }) => m.kind !== "partial")
    .slice(0, 1)
    .map(({ r, m }) => recipeCandidate(r, m.kind));
}

export type ParsedItem = {
  name: string;
  brand: string;
  /** null — штуки без известного веса штуки (продукт не найден или без порции). */
  grams: number | null;
  pieces: number | null;
  state: "raw" | "cooked" | "unknown";
  confidence: number;
  sourceText: string;
  /** Экран подтверждения добавляет сюда и продукт из «другой…» — поэтому match необязателен. */
  candidates: Candidate[];
};

export type MatchInput = {
  name: string;
  brand?: string;
  /** Английское название от ИИ («pasta, dry») — запасной запрос к справочнику USDA. */
  nameEn?: string;
  amount: Amount;
  state?: ParsedItem["state"];
  confidence?: number;
  sourceText: string;
};

const TOP = 3;

/**
 * Кандидаты. Запросы по очереди: с брендом → без бренда → английское название →
 * по одному слову названия (сначала первое — в русских названиях это обычно сам
 * продукт: «пармезан выдержанный», потом остальные от длинных к коротким).
 * Берём первый, где лучший результат совпал целыми словами. Найденное по одному
 * слову — лишь похожее на позицию (match: partial): «сыр лори» по слову «сыр» —
 * «Сыр бри», а «молоко овсяное» по слову «молоко» — коровье. Если целыми словами
 * не нашлось нигде — первый непустой ответ, тоже похожие. Похожие экран сам не
 * выбирает: «оливье 200» не должно молча записаться оливковым маслом на 1770 ккал.
 * Вид (сырое/готовое) поднимает подходящий вариант: паста raw → «Макароны, сухие».
 */
export async function findCandidates(
  db: DB,
  ownerId: string,
  name: string,
  brand = "",
  hints: { state?: ParsedItem["state"]; nameEn?: string } = {},
): Promise<FoodHit[]> {
  const queries = [brand ? `${name} ${brand}` : "", name, hints.nameEn ?? ""].map((q) => ({ q, whole: true }));
  const tokens = queryTokens(name);
  if (tokens.length > 1) {
    const [first, ...rest] = tokens;
    queries.push(...[first, ...rest.sort((a, b) => b.length - a.length)].map((q) => ({ q, whole: false })));
  }
  const similar = (found: FoodHit[]) => found.map((f) => ({ ...f, match: "partial" as const }));
  let fallback: FoodHit[] = [];
  for (const { q, whole } of queries) {
    if (!q) continue;
    const found = await searchFoods(db, ownerId, q, TOP, { state: hints.state });
    if (found[0] && found[0].match !== "partial") return whole ? found : similar(found);
    if (!fallback.length) fallback = found;
  }
  return similar(fallback);
}

export async function matchItems(db: DB, ownerId: string, inputs: MatchInput[]): Promise<ParsedItem[]> {
  return Promise.all(
    inputs.map(async (i) => {
      const [dishes, foods] = await Promise.all([
        ownDishes(db, ownerId, i.name),
        findCandidates(db, ownerId, i.name, i.brand, { state: i.state, nameEn: i.nameEn }),
      ]);
      const candidates: Candidate[] = [...dishes, ...foods].slice(0, TOP + 1);
      const pieces = "pieces" in i.amount ? i.amount.pieces : null;
      // Вес штуки — только у найденного продукта: «2 шт» похожего — не тот вес.
      const found = candidates[0] && candidates[0].match !== "partial" ? candidates[0] : null;
      return {
        name: i.name,
        brand: i.brand ?? "",
        grams: amountToGrams(i.amount, found?.defaultPortionG ?? null),
        pieces,
        state: i.state ?? "unknown",
        confidence: i.confidence ?? 1,
        sourceText: i.sourceText,
        candidates,
      };
    }),
  );
}
