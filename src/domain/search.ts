// Нормализация текста для поиска продуктов. Одна функция и для индексации
// (foods.search_text), и для запроса — иначе «ё» и регистр разъедутся.

/** «Сливки 20%, жирные» → «сливки 20 жирные». */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(\d),(\d)/g, "$1.$2") // «3,2%» и «3.2» — одно и то же
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/(^|\s)\.|\.(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Текст, по которому ищется продукт: название, синонимы, бренд, английское название. */
export function buildSearchText(f: {
  nameRu: string;
  aliases?: string[] | null;
  brand?: string | null;
  nameEn?: string | null;
}): string {
  return normalizeSearch([f.nameRu, ...(f.aliases ?? []), f.brand ?? "", f.nameEn ?? ""].join(" "));
}

/**
 * Слова запроса. Предлоги и единицы веса отбрасываем: «творог 5% 200 г» ищет
 * «творог 5», а граммы разбирает уже экран добавления.
 */
const STOP = new Set(["и", "с", "со", "в", "на", "из", "без", "г", "гр", "грамм", "мл", "шт", "кг", "л"]);
export function queryTokens(query: string): string[] {
  const tokens = normalizeSearch(query)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
  // Число граммов в конце («кефир 250») — не часть названия, если это не жирность.
  if (tokens.length > 1 && /^\d{3,}$/.test(tokens[tokens.length - 1])) tokens.pop();
  return [...new Set(tokens)].slice(0, 6);
}

// Окончания прилагательных и существительных, от длинных к коротким.
const ENDINGS = [
  "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими",
  "ой", "ый", "ий", "ая", "яя", "ое", "ее", "ые", "ие", "ую", "юю", "ом", "ем", "ым", "им", "ых", "их", "ов", "ев", "ей",
  "а", "я", "о", "е", "и", "ы", "у", "ю", "ь", "й",
];

/**
 * Лёгкий стемминг для поиска подстрокой: «сырой» и «сырые» → «сыр»,
 * «яблоко» → «яблок», «варёный» → «варен». Слова короче 5 букв и не
 * кириллица не трогаем («сыр», «rummo», «20»).
 */
export function stem(token: string): string {
  if (token.length < 5 || !/^[а-я]+$/.test(token)) return token;
  for (const e of ENDINGS) {
    if (token.endsWith(e) && token.length - e.length >= 3) return token.slice(0, -e.length);
  }
  return token;
}

// ── Целые слова ────────────────────────────────────────────────────────────
// Подстрока по основе находит и «паст|ернак» на запрос «паста». Для порядка
// выдачи важнее, совпало ли слово целиком (в любой форме): «пасты» ~ «паста»,
// «сыра» ~ «сыр», но «сырок», «сырники», «пастернак» — другие слова.

/**
 * Возможные основы слова: само слово и оно без каждого из окончаний (основа ≥ 3
 * букв); беглая гласная — «сливок» ~ «сливки», «сырок» ~ «сырки». Латиница —
 * без -s/-es, числа и прочее — как есть. Два слова — одно, если основы пересеклись.
 */
function wordForms(word: string): string[] {
  if (/^[a-z]+$/.test(word)) {
    const forms = [word];
    if (word.length > 3 && word.endsWith("s")) forms.push(word.slice(0, -1));
    if (word.length > 4 && word.endsWith("es")) forms.push(word.slice(0, -2));
    return forms;
  }
  if (!/^[а-я]+$/.test(word)) return [word];
  const forms = [word];
  for (const e of ENDINGS) if (word.endsWith(e) && word.length - e.length >= 3) forms.push(word.slice(0, -e.length));
  if (word.length >= 5 && /[ое]к$/.test(word)) forms.push(word.slice(0, -2) + "к");
  return forms;
}

export type FoodState = "raw" | "cooked";

// Слова о виде продукта (после normalizeSearch: «ё» → «е»). «Сухой» — крупа и паста до варки.
// «Сыром» сюда не входит: это и «сыр» в творительном падеже.
const ADJ_ENDINGS = ["ой", "ый", "ий", "ая", "ое", "ые", "ие", "ых", "их", "ого", "ому", "ую", "ым", "им", "ыми", "ими"];
const adj = (...stems: string[]) => stems.flatMap((s) => ADJ_ENDINGS.map((e) => s + e));
const DRY = new Set([...adj("сух"), "dry", "uncooked"]);
const RAW = new Set([...adj("сыр"), "raw"]);
const COOKED = new Set([
  ...adj("варен", "варенн", "отварн", "готов", "приготовленн", "жарен", "жаренн", "обжаренн", "запечен", "запеченн", "тушен", "тушенн", "печен", "печенн"),
  ...["cooked", "boiled", "fried", "roasted", "baked", "stewed", "braised", "grilled", "steamed", "microwaved"],
]);
const isStateWord = (w: string) => DRY.has(w) || RAW.has(w) || COOKED.has(w);
// Сушёное — не «сухое до варки»: сушёные яблоки не сырые и не готовые. У USDA они при этом
// «dried, uncooked», и без этой проверки «два яблока» (raw) находили сушёные (243 ккал вместо 48).
const DRIED = new Set([
  ...adj("сушен", "сушенн", "вялен", "обезвожен", "обезвоженн", "сублимирован", "сублимированн"),
  "dried", "dehydrated",
]);

/** Вид по словам: сухое → raw (даже «гречка жареная, сухая»), иначе готовое, иначе сырое. */
function stateOfWords(words: string[]): FoodState | null {
  if (words.some((w) => DRY.has(w))) return "raw";
  if (words.some((w) => COOKED.has(w))) return "cooked";
  if (words.some((w) => RAW.has(w))) return "raw";
  return null;
}

/**
 * Одно ли это слово в разных формах. Слово о виде («сырой», «сухие») равно только
 * другому такому же: «сыр» и «сырая» — разные слова, хотя основа общая.
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (isStateWord(a) !== isStateWord(b)) return false;
  const fb = wordForms(b);
  return wordForms(a).some((f) => fb.includes(f));
}

/**
 * Вид продукта по названию: русское решает, английское (USDA) — если в русском
 * нет слов о виде («dry heat» у запечённой рыбы не делает её сухой). Сушёное без
 * других слов о виде — вид неизвестен («Яблоки, сушёные» — не raw, хотя в USDA «uncooked»).
 */
export function foodState(nameRu: string, nameEn?: string | null): FoodState | null {
  const ru = normalizeSearch(nameRu).split(" ");
  const fromRu = stateOfWords(ru);
  if (fromRu || ru.some((w) => DRIED.has(w)) || !nameEn) return fromRu;
  const en = normalizeSearch(nameEn).split(" ");
  return en.some((w) => DRIED.has(w)) ? null : stateOfWords(en);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Регулярка «целое слово в любой форме» для SQL (search_text ~ '(^| )…( |$)'):
 * основы запроса + необязательное окончание. Грубее sameWord (слова о виде не
 * отличает), нужна только чтобы кандидаты с целым словом попали в выборку.
 */
export function tokenPattern(token: string): string {
  const forms = [...new Set(wordForms(token))].map(escapeRe).join("|");
  if (/^[a-z]+$/.test(token)) return `(${forms})(s|es)?`;
  if (!/^[а-я]+$/.test(token)) return `(${forms})`;
  return `(${forms})(${ENDINGS.join("|")})?`;
}

export type SearchQuery = {
  /** Слова запроса (queryTokens). */
  tokens: string[];
  /** Они же без слов о виде — то, что должно совпасть с названием или синонимом. */
  core: string[];
  /** Вид: из подсказки (ИИ: raw/cooked) или из слов запроса («сухой пасты»). */
  state: FoodState | null;
};

export function parseQuery(query: string, state?: FoodState | "unknown" | null): SearchQuery {
  const tokens = queryTokens(query);
  return {
    tokens,
    core: tokens.filter((t) => !isStateWord(t)),
    state: state === "raw" || state === "cooked" ? state : stateOfWords(tokens),
  };
}

/**
 * exact — название (целиком или до первой запятой, без скобок), синоним или
 * английское название — ровно запрос, с точностью до форм и порядка слов
 * («творожного сыра» = синоним «творожный сыр»; «сухой пасты» = синоним «паста»);
 * words — каждое слово запроса нашлось целым словом;
 * partial — какое-то слово нашлось только подстрокой или по сходству («паст|ернак»).
 */
export type MatchKind = "exact" | "words" | "partial";

export type FoodMatch = {
  /** Сколько слов запроса нашлось целым словом (в названии, синонимах, бренде, английском названии). */
  whole: number;
  kind: MatchKind;
  /** Название начинается с первого слова запроса (целым словом). */
  nameStart: boolean;
  /** Название начинается с основы первого слова — для недопечатанного слова («парм»). */
  prefixStart: boolean;
  /**
   * В названии «с X», а X в запросе нет: «Рис жареный с курицей» на запрос «рис»
   * — уже блюдо, а не рис. Такие — после продукта без добавок.
   */
  withExtra: boolean;
  /** Вид совпал с запросом +1, противоположный −1, неизвестен или не задан 0. */
  state: -1 | 0 | 1;
};

type Matchable = { nameRu: string; aliases?: string[] | null; brand?: string | null; nameEn?: string | null };

const words = (text: string) => normalizeSearch(text).split(" ").filter(Boolean);

/**
 * Фразы, которые могут целиком равняться запросу: название целиком и до первой
 * запятой (без скобок), синонимы, английское название целиком и до запятой.
 * Текст в скобках — не название, а уточнение: «Бекон растительный (без мяса)»,
 * «Телятина, рёбра (без жира)», «Лецитин соевый (масло)» не равны «мясо», «жир», «масло».
 */
function phrases(f: Matchable): string[][] {
  const name = f.nameRu.replace(/\([^)]*\)/g, " ");
  const en = f.nameEn ?? "";
  return [name, name.split(",")[0], ...(f.aliases ?? []), en, en.split(",")[0]]
    .map((p) => words(p).filter((w) => !STOP.has(w)))
    .filter((p) => p.length > 0);
}

/** Одинаковые наборы слов с точностью до форм и порядка: «сыр творожный» = «творожного сыра». */
const sameWords = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.some((y) => sameWord(x, y))) && b.every((y) => a.some((x) => sameWord(x, y)));

/**
 * Слова текста без цели «для X»: «Основа для пирога» — не пирог, «Виноградные
 * листья» с синонимом «для долмы» — не долма, «Соус для пиццы» — не пицца. Иначе
 * на название блюда разбор текста ставил ингредиент как найденный целиком.
 * Если «для» есть в самом запросе («соус для пиццы»), слова считаются все.
 */
function ownWords(texts: (string | null | undefined)[], keepPurpose: boolean): string[] {
  return texts.flatMap((t) => {
    const ws = words(t ?? "");
    return keepPurpose ? ws : ws.filter((_, i) => ws[i - 1] !== "для");
  });
}

export function matchFood(q: SearchQuery, f: Matchable): FoodMatch {
  const all = ownWords([f.nameRu, ...(f.aliases ?? []), f.brand, f.nameEn], q.tokens.includes("для"));
  const whole = q.tokens.filter((t) => all.some((w) => sameWord(t, w))).length;
  // Слова о виде в запросе («сухой пасты») не мешают равенству с синонимом «паста». Без них в
  // запросе «сырая»/«варёная» в названии — тоже не помеха: «Морковь сырая» = «морковь», иначе её
  // обгоняют консервы с синонимом «морковь». А «сухое» — часть продукта: «сухое молоко» ≠ «молоко».
  const stateInQuery = q.core.length < q.tokens.length;
  const ignored = stateInQuery ? isStateWord : (w: string) => RAW.has(w) || COOKED.has(w);
  const exact =
    q.core.length > 0 &&
    phrases(f).some((p) => sameWords(q.tokens, p) || sameWords(q.core, p.filter((w) => !ignored(w))));
  const name = words(f.nameRu);
  const first = q.tokens[0] ?? "";
  const state = q.state ? foodState(f.nameRu, f.nameEn) : null;
  // «Паста с курицей в сливочном соусе»: слово после «с»/«со» до запятой — добавка.
  const main = words(f.nameRu.replace(/\([^)]*\)/g, " ").split(",")[0]);
  const withExtra = main.some((w, i) => i > 0 && (main[i - 1] === "с" || main[i - 1] === "со") && !q.tokens.some((t) => sameWord(t, w)));
  return {
    whole,
    withExtra,
    kind: whole < q.tokens.length ? "partial" : exact ? "exact" : "words",
    nameStart: name.length > 0 && sameWord(first, name[0]),
    prefixStart: first !== "" && name.join(" ").startsWith(stem(first)),
    state: !q.state || !state ? 0 : state === q.state ? 1 : -1,
  };
}

/**
 * Справочник ответил скудно: пусто, ни один вариант не совпал всеми словами целиком
 * (только начала других слов: «паст|ернак», «сыр|ок») или меньше трёх вариантов и ни
 * одного точного. Тогда стоит сразу искать и в Open Food Facts (PickFoodSheet).
 */
export function weakResults(items: { match?: MatchKind }[]): boolean {
  if (!items.some((f) => f.match !== "partial")) return true;
  return items.length < 3 && !items.some((f) => f.match === "exact");
}
