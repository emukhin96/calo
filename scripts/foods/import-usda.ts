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
};

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
    out.push({ ref: `${src}:${fdcId}`, category: f.category, nameEn: f.nameEn, nutrients });
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
  const withMicros = foods.filter((f) => f.nutrients.vitC != null && f.nutrients.calcium != null).length;
  console.log(`usda.json: ${foods.length} продуктов, с витаминами и минералами: ${withMicros}`);
}

main();
