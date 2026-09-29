/**
 * Импорт базового справочника из USDA FoodData Central (docs/PLAN.md, этап 1).
 *   pnpm tsx scripts/foods/import-usda.ts
 * Скачивает Foundation + SR Legacy в .data/usda (если нет), отбирает продукты,
 * переводит нутриенты в NutrientVector и пишет seed/foods/usda.json.
 * Русские названия — отдельный файл seed/foods/usda.ru.json (translate-агенты).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { NutrientKey, NutrientVector } from "../../src/domain/nutrients";

const ROOT = path.resolve(__dirname, "../..");
const CACHE = path.join(ROOT, ".data/usda");
const DATASETS = {
  fd: { name: "foundation_food_csv_2026-04-30", dataType: "foundation_food" },
  sr: { name: "sr_legacy_food_csv_2018-04", dataType: "sr_legacy_food" },
} as const;
type Src = keyof typeof DATASETS;

// Коды нутриентов USDA → наш ключ. Несколько кодов — по приоритету (первый найденный).
const NUTRIENT_IDS: Record<Exclude<NutrientKey, "omega3">, number[]> = {
  kcal: [1008, 2048, 2047], // Foundation часто даёт только Atwater
  protein: [1003],
  fat: [1004, 1085],
  carbs: [1005, 1050],
  fiber: [1079],
  sugar: [2000, 1063],
  vitA: [1106],
  vitC: [1162],
  vitD: [1114],
  vitE: [1109],
  vitK: [1185],
  b1: [1165],
  b2: [1166],
  b6: [1175],
  b9: [1190, 1177], // DFE, иначе total
  b12: [1178],
  calcium: [1087],
  iron: [1089],
  magnesium: [1090],
  potassium: [1092],
  sodium: [1093],
  zinc: [1095],
  selenium: [1103],
};
const OMEGA3_IDS = { ala: [1404, 1270], epa: [1278], dpa: [1280], dha: [1272] };

const EXCLUDED_CATEGORIES = new Set([
  "Baby Foods", "Fast Foods", "Restaurant Foods", "American Indian/Alaska Native Foods",
  "Meals, Entrees, and Side Dishes", "Breakfast Cereals",
]);
const MEAT = new Set(["Beef Products", "Lamb, Veal, and Game Products", "Pork Products", "Poultry Products"]);

/** Бренды: «Pillsbury Golden Layer…», «…, KRAFT», ®. */
function isBranded(d: string): boolean {
  const first = d.split(",")[0];
  const capitalized = (first.match(/[A-Za-z'&]+/g) ?? []).filter((w) => /^[A-Z]/.test(w));
  return (
    capitalized.length >= 2 ||
    /\b[A-Z]{3,}\b/.test(d) ||
    /®|™|\bformerly\b|USDA Commodity|school|\bNFS\b/i.test(d)
  );
}

/** Мясо: убираем повторы по сортам и степени зачистки, субпродукты и дичь. */
function isMeatNoise(d: string): boolean {
  const s = d.toLowerCase();
  if (/\b(choice|select|prime)\b/.test(s) && !s.includes("all grades")) return true;
  if (s.includes("separable lean and fat") && !s.includes('trimmed to 0"')) return true;
  if (/trimmed to 1\/[48]"/.test(s)) return true;
  return /\b(imported|new zealand|australian|variety meats|by-products|mechanically|retail cuts|game|separable fat|fat only|skin only|giblets|neck|back,|feet|lungs|spleen|pancreas|brain|thymus|chitterlings|ears|tail|snout|jowl|composite of trimmed)\b/.test(s);
}

/** Шум: соль/без соли дубли, сухие смеси, экзотика, которую в России не едят. */
const NOISE =
  /\b(with salt|low sodium|no salt|reduced sodium|dry mix|with added solution|mix, prepared|frostings?|puddings?|imitation|hawaii|alaska|mamey|mammy|convolvulus|pokeberry|lambsquarters|borage|burdock|cardoon|chrysanthemum|arrowhead|balsam|amaranth leaves|hyacinth|jute|lotus|mountain yam|taro|yautia|winged bean|yardlong|ulluco|cassava leaves|fireweed|nopales|tree fern|cowpeas, leafy|sesbania|squash, winter, hubbard|acerola|cherimoya|feijoa|jujube|longans|loquats|lychees?|mulberries|pitanga|rose-apples|sapodilla|sapotes?|soursop|carambola|tamarinds|groundcherries|breadfruit|java-plum|kumquats|rowal|abiyuch|mammy-apple|carissa|durian|oheloberries|roselle|nance|tomatillos|cuttlefish|abalone|whelk|conch|eel|drum|burbot|cusk|dolphinfish|mullet|pout|sucker|wolffish|lingcod|pike|ling|scup|spot|sheepshead|tilefish|butterfish|carp|croaker|roe|milkfish|pompano|turbot|yellowtail|emu|ostrich|goose|squab|pheasant|quail|dove|guinea|bison|beefalo|elk|deer|moose|caribou|antelope|boar|buffalo|rabbit|horse|frog|turtle|opossum|raccoon|squirrel|muskrat|beaver)\b/i;

const SAUCES = /\b(sauce|mayonnaise|ketchup|pesto|salsa|broth|stock)\b/i;

export type UsdaSeedFood = {
  ref: string; // "fd:123456" | "sr:171247"
  category: string;
  nameEn: string;
  nutrients: NutrientVector;
  /** Вес одной штуки/ломтика — для «яйцо 2 шт». */
  portion?: { grams: number; label: string };
};

// Поштучные порции USDA → русская подпись. Чашки, унции, ложки не берём.
const PIECE_WORDS: [RegExp, string][] = [
  [/\b(extra large|jumbo|large|medium|small|each|piece|pieces|fruit|egg|whole|unit)\b/i, "1 шт"],
  [/\b(banana|onion|tomato(es)?|pepper|potato|apple|orange|carrot)\b/i, "1 шт"],
  [/\bslice\b/i, "1 ломтик"],
  [/\bfillet\b/i, "1 филе"],
  [/\bsteak\b/i, "1 стейк"],
  [/\bchop\b/i, "1 отбивная"],
  [/\bbreast\b/i, "1 грудка"],
  [/\b(drumstick|thigh|leg|wing)\b/i, "1 шт"],
  [/\b(cookie|cracker|bar|muffin|roll|bagel|biscuit|waffle|pancake|tortilla|link|patty|sausage|frankfurter)\b/i, "1 шт"],
  [/\b(clove)\b/i, "1 зубчик"],
  [/\b(stalk|spear)\b/i, "1 стебель"],
];
const NOT_PIECE = /\b(cup|oz|tbsp|tsp|tablespoon|teaspoon|lb|can|package|serving|quart|pint|cubic|nlea|yield|container|jar|bottle|pat|stick|dash|pinch)\b/i;

type PortionRow = { fdc_id: string; amount: string; measure_unit_id: string; modifier: string; portion_description: string; gram_weight: string };

function piecePortion(rows: PortionRow[], units: Map<string, string>, nameEn: string): UsdaSeedFood["portion"] {
  const candidates = rows.flatMap((r) => {
    const unit = units.get(r.measure_unit_id) ?? "";
    const text = `${unit === "undetermined" ? "" : unit} ${r.modifier} ${r.portion_description}`.trim();
    const amount = Number(r.amount) || 1;
    const grams = Number(r.gram_weight) / amount;
    if (!(grams > 0) || NOT_PIECE.test(text)) return [];
    const match = PIECE_WORDS.find(([re]) => re.test(text));
    return match ? [{ text: text.toLowerCase(), grams, label: match[1] }] : [];
  });
  if (candidates.length === 0) return undefined;
  // Яйца — «large» (≈ российская С1), остальное — «medium», иначе первая поштучная.
  const prefer = /^egg/i.test(nameEn) ? ["large", "medium"] : ["medium", "large"];
  const best =
    prefer.map((w) => candidates.find((c) => new RegExp(`\\b${w}\\b`).test(c.text) && !/extra/.test(c.text))).find(Boolean) ??
    candidates[0];
  const grams = Math.round(best.grams);
  return { grams, label: `${best.label} (${grams} г)` };
}

function csv(src: Src, file: string): Record<string, string>[] {
  const dir = path.join(CACHE, DATASETS[src].name, `FoodData_Central_${DATASETS[src].name}`);
  return parse(readFileSync(path.join(dir, file)), { columns: true, skip_empty_lines: true });
}

function ensureDownloaded() {
  mkdirSync(CACHE, { recursive: true });
  for (const { name } of Object.values(DATASETS)) {
    if (existsSync(path.join(CACHE, name))) continue;
    const zip = path.join(CACHE, `${name}.zip`);
    console.log(`download ${name}`);
    execFileSync("curl", ["-sSfL", "-o", zip, `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_${name}.zip`]);
    execFileSync("unzip", ["-qo", zip, "-d", path.join(CACHE, name)]);
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;

function load(src: Src): UsdaSeedFood[] {
  const categories = new Map(csv(src, "food_category.csv").map((r) => [r.id, r.description]));
  const picked = new Map<string, { category: string; nameEn: string }>();
  for (const r of csv(src, "food.csv")) {
    if (r.data_type !== DATASETS[src].dataType) continue;
    const category = categories.get(r.food_category_id) ?? "?";
    const d = r.description;
    if (EXCLUDED_CATEGORIES.has(category) || isBranded(d) || NOISE.test(d)) continue;
    if (MEAT.has(category) && isMeatNoise(d)) continue;
    if (category === "Soups, Sauces, and Gravies" && !SAUCES.test(d)) continue;
    picked.set(r.fdc_id, { category, nameEn: d });
  }

  const values = new Map<string, Map<number, number>>();
  for (const r of csv(src, "food_nutrient.csv")) {
    if (!picked.has(r.fdc_id) || r.amount === "") continue;
    let m = values.get(r.fdc_id);
    if (!m) values.set(r.fdc_id, (m = new Map()));
    m.set(Number(r.nutrient_id), Number(r.amount));
  }

  const units = new Map(csv(src, "measure_unit.csv").map((r) => [r.id, r.name]));
  const portions = new Map<string, PortionRow[]>();
  for (const r of csv(src, "food_portion.csv") as PortionRow[]) {
    if (!picked.has(r.fdc_id)) continue;
    portions.set(r.fdc_id, [...(portions.get(r.fdc_id) ?? []), r]);
  }

  const out: UsdaSeedFood[] = [];
  for (const [fdcId, f] of picked) {
    const v = values.get(fdcId) ?? new Map<number, number>();
    const first = (ids: number[]) => ids.map((id) => v.get(id)).find((x) => x != null);
    const nutrients: NutrientVector = {};
    for (const [key, ids] of Object.entries(NUTRIENT_IDS)) {
      const x = first(ids);
      nutrients[key as NutrientKey] = x == null ? null : round(x);
    }
    const parts = Object.values(OMEGA3_IDS).map(first);
    // Омега-3 известна, если есть хотя бы ALA (основная часть в растительной еде).
    nutrients.omega3 = parts[0] == null ? null : round(parts.reduce<number>((s, x) => s + (x ?? 0), 0));
    if (nutrients.kcal == null || nutrients.protein == null) continue; // без КБЖУ бесполезно
    const portion = piecePortion(portions.get(fdcId) ?? [], units, f.nameEn);
    out.push({ ref: `${src}:${fdcId}`, category: f.category, nameEn: f.nameEn, nutrients, ...(portion ? { portion } : {}) });
  }
  return out;
}

function main() {
  ensureDownloaded();
  // Foundation первым: при совпадении названия берём более свежие данные.
  const norm = (d: string) => d.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  const seen = new Set<string>();
  const foods = [...load("fd"), ...load("sr")].filter((f) => {
    const k = norm(f.nameEn);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  foods.sort((a, b) => a.category.localeCompare(b.category) || a.nameEn.localeCompare(b.nameEn));

  const outDir = path.join(ROOT, "seed/foods");
  mkdirSync(outDir, { recursive: true });
  // Одна запись на строку: читаемые диффы при обновлении.
  writeFileSync(
    path.join(outDir, "usda.json"),
    "[\n" + foods.map((f) => JSON.stringify(f)).join(",\n") + "\n]\n",
  );
  // Плотности нутриентов на 1 ккал, 90-й процентиль по справочнику: верхняя
  // правдоподобная оценка для продуктов с неизвестным составом (src/domain/week.ts).
  const density: Partial<Record<NutrientKey, number>> = {};
  for (const key of Object.keys(NUTRIENT_IDS).concat("omega3") as NutrientKey[]) {
    if (key === "kcal") continue;
    const xs = foods
      .filter((f) => (f.nutrients.kcal ?? 0) >= 20 && f.nutrients[key] != null)
      .map((f) => f.nutrients[key]! / f.nutrients.kcal!)
      .sort((a, b) => a - b);
    if (xs.length >= 50) density[key] = Math.round(xs[Math.floor(xs.length * 0.9)] * 10000) / 10000;
  }
  writeFileSync(path.join(outDir, "density.json"), JSON.stringify(density, null, 2) + "\n");

  const withMicros = foods.filter((f) => f.nutrients.vitC != null && f.nutrients.calcium != null).length;
  console.log(`usda.json: ${foods.length} продуктов, с витаминами и минералами: ${withMicros}, с весом штуки: ${foods.filter((f) => f.portion).length}`);
}

main();
