import "server-only";
import { isLabelConsistent, type NutrientVector } from "@/domain/nutrients";
import type { FoodUpsert } from "@/db/foods";

// Open Food Facts: брендовые продукты (поиск по названию и штрихкоду).
// Обычно только КБЖУ + клетчатка/сахар/натрий, витаминов почти нет.
// Правила API: свой User-Agent, не чаще ~10 поисков в минуту.
const UA = "Calo/0.1 (personal nutrition diary; https://calc.egor.am)";
const SEARCH = "https://search.openfoodfacts.org/search";
const PRODUCT = "https://world.openfoodfacts.org/api/v2/product";
const FIELDS = "code,product_name,product_name_ru,generic_name_ru,brands,nutriments,quantity,serving_size";

type OffNutriments = Record<string, number | string | undefined>;
type OffProduct = {
  code: string;
  product_name?: string;
  product_name_ru?: string;
  generic_name_ru?: string;
  brands?: string | string[];
  nutriments?: OffNutriments;
  serving_size?: string;
};

const num = (x: unknown): number | null => {
  const n = typeof x === "string" ? Number(x.replace(",", ".")) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null;
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
    calcium: n["calcium_100g"] != null ? num(Number(n["calcium_100g"]) * 1000) : null,
  };
}

/** Порция из «30 g» / «250 мл» — в граммах (мл ≈ г для напитков). */
function portionGrams(serving?: string): number | null {
  const m = serving?.match(/(\d+(?:[.,]\d+)?)\s*(g|г|ml|мл)\b/i);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function toFood(p: OffProduct): FoodUpsert | null {
  const nutrients = offNutrients(p.nutriments);
  const name = (p.product_name_ru || p.product_name || p.generic_name_ru || "").trim();
  // Без КБЖУ или с несходящейся этикеткой продукт в дневнике только навредит.
  if (!name || !isLabelConsistent(nutrients)) return null;
  const brand = (Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(",")[0])?.trim() || null;
  const portion = portionGrams(p.serving_size);
  return {
    source: "off",
    sourceRef: p.code,
    nameRu: name,
    brand,
    nutrientsPer100g: nutrients,
    defaultPortionG: portion,
    portionLabel: portion ? p.serving_size ?? null : null,
  };
}

async function get(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OFF ${res.status}`);
  return res.json();
}

/** Поиск по названию/бренду. Результаты не сохраняются — только при выборе. */
export async function searchOff(query: string, limit = 15): Promise<FoodUpsert[]> {
  const url = `${SEARCH}?${new URLSearchParams({ q: query, langs: "ru,en", page_size: String(limit * 2), fields: FIELDS })}`;
  const data = (await get(url)) as { hits?: OffProduct[] };
  return (data.hits ?? []).map(toFood).filter((f): f is FoodUpsert => f != null).slice(0, limit);
}

/** Продукт по штрихкоду (EAN-8/13, UPC). null — нет в базе или нет КБЖУ. */
export async function fetchOffProduct(code: string): Promise<FoodUpsert | null> {
  if (!/^\d{8,14}$/.test(code)) return null;
  const data = (await get(`${PRODUCT}/${code}.json?fields=${FIELDS}`)) as { status?: number; product?: OffProduct };
  if (data.status !== 1 || !data.product) return null;
  return toFood({ ...data.product, code });
}
