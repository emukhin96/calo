/**
 * Русские базовые продукты, которых нет или почти нет в USDA (творог 5%, ряженка,
 * докторская…). Цифры не пишем руками: для каждого продукта берём товары из
 * Open Food Facts, отсеиваем неподходящие и берём медиану по каждому нутриенту.
 *   pnpm tsx scripts/foods/import-off-staples.ts   →  seed/foods/staples.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isLabelConsistent, type NutrientKey, type NutrientVector } from "../../src/domain/nutrients";
import type { StapleFood } from "../../src/db/seed-foods";

type Staple = {
  slug: string;
  nameRu: string;
  aliases: string[];
  query: string;
  /** Название товара должно подходить под это выражение. */
  match: RegExp;
  /** И не подходить под это (соседние категории: «творожная масса» ≠ «творог»). */
  exclude?: RegExp;
  /** Жирность на этикетке, г/100 г: ±допуск. */
  fat?: [number, number];
};

const DAIRY_EXCLUDE = /масса|сырок|десерт|паста|шоколад|ваниль|изюм|ягод|клубни|персик|вишн|банан|фрукт|топлен|коктейл|детск|агуша|тема|безлакт/i;

const STAPLES: Staple[] = [
  ...[0, 2, 5, 9].map((f) => ({
    slug: `tvorog-${f}`, nameRu: `Творог ${f}%`, aliases: ["творог", "cottage cheese"],
    query: `творог ${f}%`, match: /творог/i, exclude: DAIRY_EXCLUDE, fat: [f, f === 0 ? 0.6 : 0.6] as [number, number],
  })),
  ...[1, 2.5, 3.2].map((f) => ({
    slug: `kefir-${f}`, nameRu: `Кефир ${String(f).replace(".", ",")}%`, aliases: ["кефир", "kefir"],
    query: `кефир ${String(f).replace(".", ",")}%`, match: /кефир/i, exclude: DAIRY_EXCLUDE, fat: [f, 0.3] as [number, number],
  })),
  { slug: "ryazhenka-4", nameRu: "Ряженка 4%", aliases: ["ряженка"], query: "ряженка 4%", match: /ряженка/i, exclude: DAIRY_EXCLUDE, fat: [4, 0.6] },
  ...[10, 15, 20, 25].map((f) => ({
    slug: `smetana-${f}`, nameRu: `Сметана ${f}%`, aliases: ["сметана", "sour cream"],
    query: `сметана ${f}%`, match: /сметан/i, exclude: DAIRY_EXCLUDE, fat: [f, 1] as [number, number],
  })),
  ...[10, 20, 33].map((f) => ({
    slug: `slivki-${f}`, nameRu: `Сливки ${f}%`, aliases: ["сливки", "cream"],
    query: `сливки ${f}%`, match: /сливки/i, exclude: /растит|кондитер|спрей|взбит|сухие|десерт|коктейл|шоколад/i, fat: [f, 1.5] as [number, number],
  })),
  ...[1.5, 2.5, 3.2].map((f) => ({
    slug: `moloko-${f}`, nameRu: `Молоко ${String(f).replace(".", ",")}%`, aliases: ["молоко", "milk"],
    query: `молоко ${String(f).replace(".", ",")}%`, match: /молоко/i, exclude: /сгущ|сух|кокос|миндал|овся|соев|шоколад|банан|клубн|коктейл|топлен|детск|безлакт/i, fat: [f, 0.2] as [number, number],
  })),
  { slug: "prostokvasha", nameRu: "Простокваша 3,2%", aliases: ["простокваша"], query: "простокваша", match: /простокваш/i, exclude: DAIRY_EXCLUDE },
  { slug: "varenets", nameRu: "Варенец 2,5%", aliases: ["варенец"], query: "варенец", match: /варенец/i, exclude: DAIRY_EXCLUDE },
  { slug: "ayran", nameRu: "Айран", aliases: ["айран", "тан"], query: "айран", match: /айран/i },
  { slug: "syrok-glazirovannyy", nameRu: "Сырок творожный глазированный", aliases: ["сырок", "глазированный сырок"], query: "сырок глазированный", match: /сыр[оа]к/i },
  { slug: "tvorozhnaya-massa", nameRu: "Творожная масса сладкая", aliases: ["творожная масса"], query: "творожная масса", match: /творожн.*масс/i },
  { slug: "syr-rossiyskiy", nameRu: "Сыр Российский", aliases: ["российский сыр"], query: "сыр российский", match: /сыр.*российск|российск.*сыр/i, exclude: /плавл|хлеб|колбас/i },
  { slug: "syr-adygeyskiy", nameRu: "Сыр Адыгейский", aliases: ["адыгейский"], query: "сыр адыгейский", match: /адыгейск/i },
  { slug: "brynza", nameRu: "Брынза", aliases: ["брынза"], query: "брынза", match: /брынз/i },
  { slug: "suluguni", nameRu: "Сыр Сулугуни", aliases: ["сулугуни"], query: "сулугуни", match: /сулугуни/i, exclude: /копч/i },
  { slug: "syr-plavlenyy", nameRu: "Сыр плавленый", aliases: ["плавленый сыр", "плавленый сырок"], query: "сыр плавленый", match: /плавлен/i },
  { slug: "grechka", nameRu: "Гречка ядрица, сухая", aliases: ["гречка", "гречневая крупа", "ядрица"], query: "гречка ядрица", match: /греч/i, exclude: /лапш|хлоп|мука|каша с|готов|мёд|мед/i },
  { slug: "pshenka", nameRu: "Пшено, сухое", aliases: ["пшено", "пшенная крупа"], query: "пшено", match: /пшен/i, exclude: /хлоп|каша с|готов/i },
  { slug: "perlovka", nameRu: "Перловка, сухая", aliases: ["перловая крупа", "перловка"], query: "перловая крупа", match: /перлов/i },
  { slug: "manka", nameRu: "Манная крупа, сухая", aliases: ["манка", "манная крупа"], query: "манная крупа", match: /манн/i, exclude: /каша с|готов/i },
  { slug: "gerkules", nameRu: "Овсяные хлопья Геркулес, сухие", aliases: ["геркулес", "овсянка", "овсяные хлопья"], query: "овсяные хлопья геркулес", match: /геркулес|овсян.*хлоп/i, exclude: /мюсли|гранол|с фрукт|ягод|печень|быстр/i },
  { slug: "bulgur", nameRu: "Булгур, сухой", aliases: ["булгур"], query: "булгур", match: /булгур/i, exclude: /с овощ|готов/i },
  { slug: "khleb-borodinskiy", nameRu: "Хлеб Бородинский", aliases: ["бородинский", "черный хлеб", "ржаной хлеб"], query: "хлеб бородинский", match: /бородинск/i },
  { slug: "baton-narezhnoy", nameRu: "Батон нарезной", aliases: ["батон", "белый хлеб"], query: "батон нарезной", match: /батон/i },
  { slug: "lavash", nameRu: "Лаваш тонкий", aliases: ["лаваш"], query: "лаваш тонкий", match: /лаваш/i },
  { slug: "pelmeni", nameRu: "Пельмени замороженные", aliases: ["пельмени"], query: "пельмени", match: /пельмен/i },
  { slug: "vareniki-kartofel", nameRu: "Вареники с картофелем", aliases: ["вареники"], query: "вареники с картофелем", match: /вареник/i },
  { slug: "syrniki", nameRu: "Сырники замороженные", aliases: ["сырники"], query: "сырники", match: /сырник/i },
  { slug: "kolbasa-doktorskaya", nameRu: "Колбаса Докторская", aliases: ["докторская", "вареная колбаса"], query: "колбаса докторская", match: /докторск/i },
  { slug: "sosiski-molochnye", nameRu: "Сосиски молочные", aliases: ["сосиски"], query: "сосиски молочные", match: /сосиск/i },
  { slug: "servelat", nameRu: "Сервелат варёно-копчёный", aliases: ["сервелат"], query: "сервелат", match: /сервелат/i },
  { slug: "vetchina", nameRu: "Ветчина", aliases: ["ветчина"], query: "ветчина", match: /ветчин/i },
  { slug: "tushenka-govyazhya", nameRu: "Говядина тушёная (тушёнка)", aliases: ["тушенка", "тушёнка"], query: "говядина тушеная", match: /тушен|тушён/i },
  { slug: "seld-slabosolenaya", nameRu: "Сельдь слабосолёная, филе", aliases: ["селедка", "сельдь"], query: "сельдь слабосоленая филе", match: /сельд|селед/i, exclude: /шуб|под |в соус|в горч|в вин/i },
  { slug: "shproty", nameRu: "Шпроты в масле", aliases: ["шпроты"], query: "шпроты", match: /шпрот/i },
  { slug: "krabovye-palochki", nameRu: "Крабовые палочки", aliases: ["крабовые палочки", "сурими"], query: "крабовые палочки", match: /краб/i },
  { slug: "mayonez-67", nameRu: "Майонез Провансаль 67%", aliases: ["майонез"], query: "майонез провансаль 67", match: /майонез/i, fat: [67, 2] },
  { slug: "sgushchenka", nameRu: "Молоко сгущённое с сахаром 8,5%", aliases: ["сгущенка", "сгущёнка"], query: "молоко сгущенное с сахаром", match: /сгущ/i, exclude: /варен|какао|кофе/i },
  { slug: "kabachkovaya-ikra", nameRu: "Икра кабачковая", aliases: ["кабачковая икра"], query: "икра кабачковая", match: /кабачк/i },
  { slug: "kvas", nameRu: "Квас", aliases: ["квас"], query: "квас", match: /квас/i },
  { slug: "zefir", nameRu: "Зефир", aliases: ["зефир"], query: "зефир", match: /зефир/i, exclude: /шоколад|глазур/i },
  { slug: "pryanik", nameRu: "Пряник", aliases: ["пряники"], query: "пряники", match: /пряник/i },
  { slug: "khalva", nameRu: "Халва подсолнечная", aliases: ["халва"], query: "халва подсолнечная", match: /халв/i, exclude: /шоколад|арахис|кунжут/i },
  { slug: "semechki", nameRu: "Семечки подсолнечника жареные", aliases: ["семечки", "семки"], query: "семечки подсолнечника жареные", match: /семечк|семена подсолн/i },
];

const UA = "Calo/0.1 (personal nutrition diary; https://calc.egor.am)";
const KEYS: [NutrientKey, string, number][] = [
  // наш ключ, поле OFF, множитель
  ["kcal", "energy-kcal_100g", 1],
  ["protein", "proteins_100g", 1],
  ["fat", "fat_100g", 1],
  ["carbs", "carbohydrates_100g", 1],
  ["fiber", "fiber_100g", 1],
  ["sugar", "sugars_100g", 1],
  ["sodium", "sodium_100g", 1000], // г → мг
];
const MIN_PRODUCTS = 3;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Hit = { code: string; product_name?: string; product_name_ru?: string; nutriments?: Record<string, number> };

async function fetchHits(query: string): Promise<Hit[]> {
  const url = `https://search.openfoodfacts.org/search?${new URLSearchParams({
    q: query, langs: "ru", page_size: "60", fields: "code,product_name,product_name_ru,nutriments,countries_tags",
  })}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return ((await res.json()) as { hits: Hit[] }).hits ?? [];
    await sleep(3000);
  }
  throw new Error(`OFF search failed: ${query}`);
}

async function build(s: Staple): Promise<StapleFood | null> {
  const hits = await fetchHits(s.query);
  const good = hits.filter((h) => {
    const name = h.product_name_ru || h.product_name || "";
    const n = h.nutriments ?? {};
    if (!s.match.test(name) || s.exclude?.test(name)) return false;
    if (n["energy-kcal_100g"] == null || n["proteins_100g"] == null || n["fat_100g"] == null || n["carbohydrates_100g"] == null) return false;
    if (s.fat && Math.abs(n["fat_100g"] - s.fat[0]) > s.fat[1]) return false;
    return isLabelConsistent({
      kcal: n["energy-kcal_100g"], protein: n["proteins_100g"], fat: n["fat_100g"],
      carbs: n["carbohydrates_100g"], fiber: n["fiber_100g"],
    });
  });
  if (good.length < MIN_PRODUCTS) {
    console.warn(`  ! ${s.slug}: подходящих товаров ${good.length} < ${MIN_PRODUCTS} — пропущен`);
    return null;
  }
  const nutrients: NutrientVector = {};
  for (const [key, field, k] of KEYS) {
    const xs = good.map((h) => h.nutriments?.[field]).filter((x): x is number => typeof x === "number" && x >= 0);
    // Медиана только если значение есть хотя бы у половины товаров.
    nutrients[key] = xs.length >= Math.max(MIN_PRODUCTS, good.length / 2) ? Math.round(median(xs) * k * 100) / 100 : null;
  }
  console.log(`  ${s.slug}: ${good.length} товаров → ${nutrients.kcal} ккал, Б ${nutrients.protein} Ж ${nutrients.fat} У ${nutrients.carbs}`);
  return { slug: s.slug, nameRu: s.nameRu, aliases: s.aliases, nutrients, products: good.length };
}

async function main() {
  const out: StapleFood[] = [];
  for (const s of STAPLES) {
    const food = await build(s);
    if (food) out.push(food);
    await sleep(1200); // вежливо к API
  }
  const file = path.resolve(__dirname, "../../seed/foods/staples.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "[\n" + out.map((f) => JSON.stringify(f)).join(",\n") + "\n]\n");
  console.log(`staples.json: ${out.length} из ${STAPLES.length}`);
}

main();
