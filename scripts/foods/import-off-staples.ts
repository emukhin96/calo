/**
 * Русские базовые продукты, которых нет или почти нет в USDA (творог 5%, ряженка,
 * докторская…). Цифры не пишем руками: для каждого продукта берём товары из
 * Open Food Facts, отсеиваем неподходящие и берём медиану по каждому нутриенту.
 * Где товаров мало (армянские сыры, мацони, суджук, борщ, оливье), — справочная
 * запись OFF (ref): общие продукты из российских таблиц состава с кодами 99990…
 *   pnpm tsx scripts/foods/import-off-staples.ts       →  seed/foods/staples.json
 *   pnpm tsx scripts/foods/import-off-staples.ts new   — только продукты, которых в
 *                                                        файле ещё нет; остальные не трогаются
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isLabelConsistent, type NutrientKey, type NutrientVector } from "../../src/domain/nutrients";
import type { StapleFood } from "../../src/db/seed-foods";

type Staple = {
  slug: string;
  nameRu: string;
  aliases: string[];
  /** Поиск товаров для медианы; без него — только справочная запись ref. */
  query?: string;
  /** Название товара должно подходить под это выражение. */
  match?: RegExp;
  /**
   * Код справочной записи OFF (общий продукт, не товар) — если товаров для
   * медианы меньше MIN_PRODUCTS или поиска нет вовсе.
   */
  ref?: string;
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
  { slug: "syr-rossiyskiy", nameRu: "Сыр Российский", aliases: ["российский сыр"], query: "сыр российский", match: /сыр.*российск|российск.*сыр/i, exclude: /плавл|хлеб|колбас/i , ref: "0099990004127" },
  { slug: "syr-adygeyskiy", nameRu: "Сыр Адыгейский", aliases: ["адыгейский"], query: "сыр адыгейский", match: /адыгейск/i , ref: "0099990004018" },
  { slug: "brynza", nameRu: "Брынза", aliases: ["брынза"], query: "брынза", match: /брынз/i , ref: "0099990004040" },
  { slug: "suluguni", nameRu: "Сыр Сулугуни", aliases: ["сулугуни"], query: "сулугуни", match: /сулугуни/i, exclude: /копч/i , ref: "0099990004141" },
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
  // Блюда кавказской и среднеазиатской кухни — готовые из магазинов и кулинарий
  { slug: "plov", nameRu: "Плов (готовый)", aliases: ["плов", "плов с мясом"], query: "плов", match: /плов/i, exclude: /приправ|рис для|для плова|набор|смесь/i },
  { slug: "khachapuri", nameRu: "Хачапури с сыром", aliases: ["хачапури"], query: "хачапури", match: /хачапури/i },
  { slug: "khinkali", nameRu: "Хинкали замороженные", aliases: ["хинкали"], query: "хинкали", match: /хинкали/i },
  { slug: "manty", nameRu: "Манты замороженные", aliases: ["манты", "манти"], query: "манты", match: /манты/i },
  { slug: "chebureki", nameRu: "Чебуреки", aliases: ["чебурек", "чебуреки"], query: "чебуреки", match: /чебурек/i },
  { slug: "shaurma", nameRu: "Шаурма с курицей (готовая)", aliases: ["шаурма", "шаверма", "шаурма с курицей", "шаверма с курицей"], query: "шаурма", match: /шаурм|шаверм/i, exclude: /соус|лаваш для|приправ/i },
  // Справочные записи: товаров с такими названиями в OFF мало
  { slug: "matsoni", nameRu: "Мацони (мацун)", aliases: ["мацун", "мацони", "matsoni", "matsun"], ref: "0099990001826" },
  { slug: "matsoni-light", nameRu: "Мацони маложирный", aliases: ["мацун маложирный", "мацони маложирный"], ref: "0099990001827" },
  { slug: "syr-chanakh", nameRu: "Сыр Чанах", aliases: ["чанах"], ref: "0099990004158" },
  { slug: "syr-chechil", nameRu: "Сыр Чечил", aliases: ["чечил", "сыр косичка", "сыр-косичка"], ref: "0099990004160" },
  { slug: "sudzhuk", nameRu: "Суджук (колбаса сыровяленая)", aliases: ["суджук", "суджух", "sujuk"], ref: "0099990001292" },
  { slug: "basturma", nameRu: "Бастурма", aliases: ["бастурма", "пастурма", "basturma"], ref: "0099990000176" },
  { slug: "lavash-armyanskiy", nameRu: "Лаваш армянский", aliases: ["армянский лаваш"], ref: "0099990001521" },
  { slug: "churchkhela", nameRu: "Чурчхела", aliases: ["чурчхела", "суджух из орехов"], ref: "0099990004902" },
  { slug: "tkemali", nameRu: "Ткемали", aliases: ["ткемали", "соус ткемали"], ref: "0099990004355" },
  { slug: "adzhika", nameRu: "Аджика", aliases: ["аджика"], ref: "0099990000022" },
  { slug: "borshch", nameRu: "Борщ с мясом", aliases: ["борщ"], ref: "0099990000308" },
  { slug: "kharcho", nameRu: "Суп харчо с мясом", aliases: ["харчо", "суп харчо"], ref: "0099990003917" },
  { slug: "shchi", nameRu: "Щи из свежей капусты с картофелем", aliases: ["щи"], ref: "0099990005094" },
  { slug: "solyanka", nameRu: "Солянка сборная мясная", aliases: ["солянка"], ref: "0099990003712" },
  { slug: "okroshka-kvas", nameRu: "Окрошка мясная на квасе", aliases: ["окрошка", "окрошка на квасе"], ref: "0099990002331" },
  { slug: "okroshka-kefir", nameRu: "Окрошка на кефире", aliases: ["окрошка на кефире"], ref: "0099990002332" },
  { slug: "vinegret", nameRu: "Винегрет", aliases: ["винегрет"], ref: "0099990000452" },
  { slug: "olivye", nameRu: "Салат Оливье с колбасой", aliases: ["оливье", "салат оливье", "столичный салат"], ref: "0099990003328" },
  { slug: "bliny", nameRu: "Блины", aliases: ["блины", "блин"], ref: "0099990000267" },
  { slug: "samsa", nameRu: "Самса с курицей", aliases: ["самса"], ref: "0099990003381" },
  { slug: "kotlety-govyazhyi", nameRu: "Котлеты из говядины рубленые", aliases: ["котлета", "котлеты", "котлета говяжья"], ref: "0099990001357" },
  { slug: "kotlety-kurinye", nameRu: "Котлеты куриные", aliases: ["куриная котлета", "котлеты из курицы"], ref: "0099990001359" },
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

const consistent = (n: Record<string, number>) =>
  n["energy-kcal_100g"] != null &&
  n["proteins_100g"] != null &&
  n["fat_100g"] != null &&
  n["carbohydrates_100g"] != null &&
  isLabelConsistent({
    kcal: n["energy-kcal_100g"], protein: n["proteins_100g"], fat: n["fat_100g"],
    carbs: n["carbohydrates_100g"], fiber: n["fiber_100g"],
  });

/** Справочная запись OFF по коду. */
async function fetchRef(code: string): Promise<Hit | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,nutriments`, {
      headers: { "User-Agent": UA },
    });
    if (res.ok) {
      const data = (await res.json()) as { status?: number; product?: Hit };
      return data.status === 1 && data.product ? { ...data.product, code } : null;
    }
    await sleep(3000);
  }
  throw new Error(`OFF product failed: ${code}`);
}

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

function medianOf(s: Staple, good: Hit[]): StapleFood {
  const nutrients: NutrientVector = {};
  for (const [key, field, k] of KEYS) {
    const xs = good.map((h) => h.nutriments?.[field]).filter((x): x is number => typeof x === "number" && x >= 0);
    // Медиана только если значение есть хотя бы у половины товаров.
    const enough = xs.length >= Math.max(Math.min(MIN_PRODUCTS, good.length), good.length / 2);
    nutrients[key] = enough ? Math.round(median(xs) * k * 100) / 100 : null;
  }
  return { slug: s.slug, nameRu: s.nameRu, aliases: s.aliases, nutrients, products: good.length };
}

async function build(s: Staple): Promise<StapleFood | null> {
  if (s.query && s.match) {
    const hits = await fetchHits(s.query);
    const good = hits.filter((h) => {
      const name = h.product_name_ru || h.product_name || "";
      const n = h.nutriments ?? {};
      if (!s.match!.test(name) || s.exclude?.test(name)) return false;
      if (s.fat && Math.abs(n["fat_100g"] - s.fat[0]) > s.fat[1]) return false;
      return consistent(n);
    });
    if (good.length >= MIN_PRODUCTS) {
      const food = medianOf(s, good);
      console.log(`  ${s.slug}: ${good.length} товаров → ${food.nutrients.kcal} ккал, Б ${food.nutrients.protein} Ж ${food.nutrients.fat} У ${food.nutrients.carbs}`);
      return food;
    }
    if (!s.ref) {
      console.warn(`  ! ${s.slug}: подходящих товаров ${good.length} < ${MIN_PRODUCTS} — пропущен`);
      return null;
    }
  }
  if (!s.ref) return null;
  const ref = await fetchRef(s.ref);
  if (!ref || !consistent(ref.nutriments ?? {})) {
    console.warn(`  ! ${s.slug}: справочной записи ${s.ref} нет или этикетка не сходится — пропущен`);
    return null;
  }
  const food = { ...medianOf(s, [ref]), ref: s.ref };
  console.log(`  ${s.slug}: справочная запись «${ref.product_name}» → ${food.nutrients.kcal} ккал, Б ${food.nutrients.protein} Ж ${food.nutrients.fat} У ${food.nutrients.carbs}`);
  return food;
}

async function main() {
  const file = path.resolve(__dirname, "../../seed/foods/staples.json");
  const onlyNew = process.argv[2] === "new";
  const existing: StapleFood[] = onlyNew && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const out = new Map(existing.map((f) => [f.slug, f]));
  for (const s of STAPLES) {
    // «new»: уже посчитанные медианы не пересчитываем — данные OFF меняются, диффы были бы шумными.
    if (onlyNew && out.has(s.slug)) continue;
    const food = await build(s);
    if (food) out.set(s.slug, food);
    await sleep(1200); // вежливо к API
  }
  // Порядок — как в STAPLES: читаемые диффы.
  const order = new Map(STAPLES.map((s, i) => [s.slug, i]));
  const foods = [...out.values()].sort((a, b) => (order.get(a.slug) ?? 1e9) - (order.get(b.slug) ?? 1e9));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "[\n" + foods.map((f) => JSON.stringify(f)).join(",\n") + "\n]\n");
  console.log(`staples.json: ${foods.length} из ${STAPLES.length}`);
}

main();
