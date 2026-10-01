import "server-only";
import { canonicalBarcode, BARCODE_RE } from "@/domain/barcode";
import { brandAliases, findBrand, translitRu } from "@/domain/brands";
import type { ShopCountry } from "@/domain/country";
import { isLabelConsistent, type NutrientVector } from "@/domain/nutrients";
import { normalizeSearch, queryTokens, stem } from "@/domain/search";
import { shelfWords } from "@/domain/words";
import type { FoodUpsert } from "@/db/foods";

// Open Food Facts: брендовые продукты (поиск по названию и штрихкоду).
// Обычно только КБЖУ + клетчатка/сахар/натрий, витаминов почти нет.
// Правила API: свой User-Agent, не чаще ~10 поисков в минуту.
const UA = "Calo/0.1 (personal nutrition diary; https://calc.egor.am)";
const SEARCH = "https://search.openfoodfacts.org/search";
const PRODUCT = "https://world.openfoodfacts.org/api/v2/product";
const NAME_FIELDS = [
  "product_name_ru",
  "product_name_en",
  "product_name",
  "product_name_fr",
  "product_name_hy",
  "generic_name_ru",
  "generic_name_en",
  "generic_name",
] as const;
const FIELDS = ["code", ...NAME_FIELDS, "brands", "nutriments", "quantity", "serving_size", "countries_tags"].join(",");

type OffNutriments = Record<string, number | string | undefined>;
type OffProduct = { code: string; brands?: string | string[]; nutriments?: OffNutriments; serving_size?: string; countries_tags?: string[] } & Partial<
  Record<(typeof NAME_FIELDS)[number], string>
>;

const parse = (x: unknown): number | null => {
  const n = typeof x === "string" ? Number(x.replace(",", ".")) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const num = (x: unknown): number | null => {
  const n = parse(x);
  return n == null ? null : Math.round(n * 1000) / 1000;
};
/** Граммы на 100 г у OFF → миллиграммы (железо — тысячные доли грамма, округлять до мг рано). */
const mg = (x: unknown) => {
  const g = parse(x);
  return g == null ? null : Math.round(g * 1000 * 10) / 10;
};

export function offNutrients(n: OffNutriments = {}): NutrientVector {
  const kcal = num(n["energy-kcal_100g"]) ?? (num(n["energy-kj_100g"]) != null ? num(n["energy-kj_100g"])! / 4.184 : null);
  const sodiumG = num(n["sodium_100g"]) ?? (num(n["salt_100g"]) != null ? num(n["salt_100g"])! / 2.5 : null);
  return {
    kcal: kcal == null ? null : Math.round(kcal * 10) / 10,
    protein: num(n["proteins_100g"]),
    fat: num(n["fat_100g"]),
    carbs: num(n["carbohydrates_100g"]),
    fiber: num(n["fiber_100g"]),
    sugar: num(n["sugars_100g"]),
    sodium: sodiumG == null ? null : Math.round(sodiumG * 1000 * 10) / 10, // г → мг
    calcium: mg(n["calcium_100g"]),
    // На канадских этикетках с 2022 года — калий, кальций и железо в миллиграммах.
    potassium: mg(n["potassium_100g"]),
    iron: mg(n["iron_100g"]),
  };
}

/** Граммы спирта на 100 г: у OFF alcohol — % об. (коньяк 40 → 31,6 г). */
const alcoholGrams = (n: OffNutriments = {}) => (num(n["alcohol_100g"]) ?? 0) * 0.789;

/** Порция из «30 g» / «250 мл» / «1 cup (250 mL)» — в граммах (мл ≈ г для напитков). */
function portionGrams(serving?: string): number | null {
  const m = serving?.match(/(\d+(?:[.,]\d+)?)\s*(g|г|ml|мл)\b/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** «Sauce &gt; …», «Джелато &quot;…&quot;» — в OFF встречаются HTML-сущности. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Названия товара по предпочтению: русское, английское, основное (язык страны
 * товара: французский у Квебека, армянский), остальные. Первое — название в
 * приложении, прочие — синонимы для поиска (французское «Yogourt grec» тоже ищется).
 */
export function offNames(p: Partial<Record<(typeof NAME_FIELDS)[number], string>>): string[] {
  const out: string[] = [];
  for (const f of NAME_FIELDS) {
    const name = decodeEntities(p[f] ?? "").replace(/\s+/g, " ").trim();
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

function brandOf(p: OffProduct): string | null {
  const first = Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(",")[0];
  return first ? decodeEntities(first).trim() || null : null;
}

function toFood(p: OffProduct): FoodUpsert | null {
  const nutrients = offNutrients(p.nutriments);
  const [name, ...otherNames] = offNames(p);
  // Без КБЖУ или с несходящейся этикеткой продукт в дневнике только навредит.
  if (!name || !isLabelConsistent(nutrients, alcoholGrams(p.nutriments))) return null;
  const brand = brandOf(p);
  const portion = portionGrams(p.serving_size);
  return {
    source: "off",
    sourceRef: canonicalBarcode(p.code),
    nameRu: name,
    aliases: [...otherNames, ...brandAliases(brand)],
    brand,
    nutrientsPer100g: nutrients,
    defaultPortionG: portion,
    portionLabel: portion ? p.serving_size ?? null : null,
  };
}

/** notFound — что вернуть на HTTP 404: товар по коду OFF отдаёт так, а не status: 0 с 200. */
async function get(url: string, notFound?: unknown): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404 && notFound !== undefined) return notFound;
  if (!res.ok) throw new Error(`OFF ${res.status}`);
  return res.json();
}

/** Товар из поиска OFF: код — как в OFF (по нему выбранный товар запрашивается снова). */
export type OffHit = FoodUpsert & { code: string; local: boolean };

async function searchHits(q: string, langs: string[], size: number): Promise<OffProduct[]> {
  const url = `${SEARCH}?${new URLSearchParams({ q, langs: langs.join(","), page_size: String(size), fields: FIELDS })}`;
  return ((await get(url)) as { hits?: OffProduct[] }).hits ?? [];
}

const searchable = (f: FoodUpsert) => ` ${normalizeSearch([f.nameRu, ...(f.aliases ?? []), f.brand ?? ""].join(" "))} `;

/**
 * Каждое слово есть в названиях или бренде товара (по основе: «сметаны» ~
 * «сметана») — само, в переводе с полки (domain/words: «сметана» — «sour
 * cream» у армянской Marianna, «йогурт» — «yogourt» у канадского) или
 * латиницей («лори» — «Lori brine cheese»). Поиск OFF
 * нечёткий: на «сыр лори» он отдаёт любые сыры, на «плов» — что угодно похожее;
 * такие товары только мешают выбрать.
 */
function hasWords(f: FoodUpsert, tokens: string[]): boolean {
  const text = searchable(f);
  const has = (w: string) => {
    const n = normalizeSearch(w);
    return n.includes(" ") ? text.includes(` ${n} `) : text.includes(` ${stem(n)}`);
  };
  // Латиницей — для слов не из словаря: «лори» в «Lori brine cheese», «мацун» в «Matsun».
  const latin = (t: string) => translitRu(t) ?? "";
  return tokens.every((t) => (/^\d/.test(t) ? text.includes(t) : has(t) || shelfWords(t).some(has) || (latin(t) !== "" && has(latin(t)))));
}

/**
 * Поиск по названию/бренду. Результаты не сохраняются — только при выборе.
 * Бренд из словаря (seed/foods/brands.json) пишется как на упаковке:
 * «марианна сметана» ищет «сметана Marianna»; товары бренда, где остальных слов
 * нет (армянская «Sour Cream 18%»), остаются в выдаче ниже. Если пользователь
 * покупает в стране из domain/country (по часовому поясу), товары с местных полок
 * — первыми, а названия ищутся и на местном языке. Не нашлось (или нет местных) —
 * ещё раз по-английски по словарю полки, прочие слова латиницей: «мацун» →
 * «matsun», «йогурт греческий» в Канаде — «yogurt greek» (находит и «Yogourt grec»).
 */
export async function searchOff(query: string, opts: { country?: ShopCountry | null; limit?: number } = {}): Promise<OffHit[]> {
  const { country = null, limit = 15 } = opts;
  const langs = ["ru", "en", ...(country?.langs ?? [])];
  const brand = findBrand(query);
  const rest = brand ? brand.rest : query;
  const brandWords = brand ? queryTokens(brand.brand.brand) : [];

  type Ranked = { hit: OffHit; words: boolean; order: number };
  const ranked: Ranked[] = [];
  const codes = new Set<string>();
  const twins = new Set<string>();
  const add = (products: OffProduct[], words: string[]) => {
    for (const p of products) {
      const food = toFood(p);
      const code = String(p.code ?? "");
      if (!food || !BARCODE_RE.test(code)) continue; // без штрихкода выбранный товар не запросить
      // Один товар бывает в OFF дважды: «0099990000980» и «99990000980».
      const twin = `${normalizeSearch(`${food.nameRu} ${food.brand ?? ""}`)}|${food.nutrientsPer100g.kcal}`;
      if (codes.has(food.sourceRef) || twins.has(twin)) continue;
      const ok = hasWords(food, words);
      if (brand ? !hasWords(food, brandWords) : !ok) continue;
      codes.add(food.sourceRef);
      twins.add(twin);
      const local = country != null && (p.countries_tags ?? []).includes(`en:${country.tag}`);
      ranked.push({ hit: { ...food, code, local }, words: ok, order: ranked.length });
    }
  };
  /** words — текст запроса; tokens — слова, по которым товар считается найденным. */
  const search = async (words: string, tokens = queryTokens(words), onlyCountry = false) => {
    const text = [words, brand?.brand.brand ?? ""].join(" ").trim();
    const [inCountry, everywhere] = await Promise.all([
      // Местный поиск — добавка: его сбой не должен ронять обычный.
      country ? searchHits(`${text} countries_tags:"en:${country.tag}"`, langs, limit * 2).catch(() => []) : [],
      onlyCountry ? [] : searchHits(text, langs, limit * 2),
    ]);
    add(inCountry, tokens);
    add(everywhere, tokens);
  };

  await search(rest);
  // Второй заход — по-английски по словарю полки, остальное латиницей («сыр лори» →
  // «cheese lori»): ничего не нашлось — везде, нет местного — только в стране.
  // Не больше одного захода: OFF просит не чаще ~10 поисков в минуту. Его сбой не
  // роняет уже найденное.
  const tokens = queryTokens(rest);
  const english = tokens.map((t) => shelfWords(t, ["en"])[0] ?? translitRu(t) ?? t).join(" ");
  const found = ranked.some((r) => r.words);
  const foundHere = ranked.some((r) => r.words && r.hit.local);
  if (english !== tokens.join(" ") && (!found || (country && !foundHere))) {
    await search(english, tokens, found).catch((e) => console.warn("[off] shelf search", e));
  }

  // Где нашлись все слова — первыми, среди них местные, внутри — как отдал OFF.
  return ranked
    .sort((a, b) => Number(b.words) - Number(a.words) || Number(b.hit.local) - Number(a.hit.local) || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.hit);
}

/** Продукт по штрихкоду (EAN-8/13, UPC). null — нет в базе или нет КБЖУ. */
export async function fetchOffProduct(code: string): Promise<FoodUpsert | null> {
  if (!BARCODE_RE.test(code)) return null;
  // Неизвестный код — HTTP 404: это «нет товара» (форма «КБЖУ с упаковки»), а не «OFF не отвечает».
  const data = (await get(`${PRODUCT}/${code}.json?fields=${FIELDS}`, { status: 0 })) as { status?: number; product?: OffProduct };
  if (data.status !== 1 || !data.product) return null;
  return toFood({ ...data.product, code });
}
