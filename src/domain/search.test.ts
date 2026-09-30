import { describe, expect, it } from "vitest";
import {
  buildSearchText,
  foodState,
  type MatchKind,
  matchFood,
  normalizeSearch,
  parseQuery,
  queryTokens,
  sameWord,
  stem,
  tokenPattern,
  weakResults,
} from "./search";

describe("normalizeSearch", () => {
  it("регистр, ё, пунктуация, десятичная запятая", () => {
    expect(normalizeSearch("Сливки 20%, жирные")).toBe("сливки 20 жирные");
    expect(normalizeSearch("Молоко 3,2%")).toBe("молоко 3.2");
    expect(normalizeSearch("Свёкла, варёная")).toBe("свекла вареная");
  });
});

describe("buildSearchText", () => {
  it("собирает название, синонимы, бренд и английское имя", () => {
    expect(
      buildSearchText({ nameRu: "Сыр пармезан", aliases: ["parmesan"], brand: null, nameEn: "Cheese, parmesan, hard" }),
    ).toBe("сыр пармезан parmesan cheese parmesan hard");
  });
});

describe("queryTokens", () => {
  it("отбрасывает предлоги, единицы и граммы в конце", () => {
    expect(queryTokens("сливки 20")).toEqual(["сливки", "20"]);
    expect(queryTokens("творог 5% 200 г")).toEqual(["творог", "5"]);
    expect(queryTokens("кефир 250")).toEqual(["кефир"]);
    expect(queryTokens("Паста из пармезана")).toEqual(["паста", "пармезана"]);
  });
});

describe("stem", () => {
  it.each([
    ["сырой", "сыр"], ["сырые", "сыр"], ["яблоко", "яблок"], ["вареный", "варен"], ["куриная", "курин"],
    ["пармезана", "пармезан"], ["молоко", "молок"], ["творог", "творог"], ["сыр", "сыр"], ["rummo", "rummo"],
    ["банан", "банан"], ["гречка", "гречк"],
  ])("%s → %s", (word, expected) => {
    expect(stem(word)).toBe(expected);
  });
});

describe("sameWord — одно слово в разных формах", () => {
  it.each([
    ["паста", "пасты"], ["паста", "пастой"], ["сыр", "сыра"], ["сыр", "сыром"], ["творожный", "творожного"],
    ["творожный", "творожная"], ["сливки", "сливок"], ["сухой", "сухие"], ["вареный", "вареные"], ["cheese", "cheeses"],
    ["20", "20"], ["3.2", "3.2"], ["макароны", "макарон"],
  ])("%s ~ %s", (a, b) => {
    expect(sameWord(a, b)).toBe(true);
    expect(sameWord(b, a)).toBe(true);
  });

  it.each([
    ["паста", "пастернак"], ["паста", "пастрома"], ["пасты", "пастила"], ["сыр", "сырок"], ["сыр", "сырники"],
    ["сыр", "сырный"], ["творог", "творожный"], ["20", "2"], ["рис", "рисовые"],
    // «сыр» и «сырой» — разные слова, хотя основа общая: слово о виде (сырой/варёный) не равно продукту
    ["сыр", "сырая"], ["сыр", "сырой"], ["сыр", "сырые"],
  ])("%s ≁ %s", (a, b) => {
    expect(sameWord(a, b)).toBe(false);
    expect(sameWord(b, a)).toBe(false);
  });
});

describe("foodState — вид продукта по названию", () => {
  it.each([
    ["Макароны, сухие", null, "raw"],
    ["Макароны, варёные, с солью", "Pasta, cooked, enriched, with added salt", "cooked"],
    ["Гречка жареная (ядрица), сухая", "Buckwheat groats, roasted, dry", "raw"],
    ["Курица, без кожи, сырая", null, "raw"],
    ["Лосось атлантический, выращенный, запечённый", "Fish, salmon, Atlantic, farmed, cooked, dry heat", "cooked"],
    ["Бананы", "Bananas, raw", "raw"],
    ["Сыр сливочный (крем-чиз)", "Cheese, cream", null],
    ["Гречка, крупа", "Buckwheat", null],
    // Сушёное — не сырое, хотя у USDA «uncooked»: иначе «яблоко» (raw) находило сушёные яблоки
    ["Яблоки, сушёные", "Apples, dried, sulfured, uncooked", null],
    ["Яблоки, обезвоженные", "Apples, dehydrated (low moisture), sulfured, uncooked", null],
    ["Помидоры вяленые", "Tomatoes, sun-dried", null],
    ["Яблоки, сушёные, варёные, без сахара", "Apples, dried, sulfured, stewed, without added sugar", "cooked"],
  ] as const)("%s → %s", (nameRu, nameEn, expected) => {
    expect(foodState(nameRu, nameEn)).toBe(expected);
  });
});

describe("parseQuery + matchFood", () => {
  const macaroniDry = { nameRu: "Макароны, сухие", aliases: ["паста", "спагетти", "макаронные изделия"], nameEn: "Pasta, dry, enriched" };
  const macaroniCooked = { nameRu: "Макароны, варёные, без соли", aliases: ["паста", "спагетти", "макаронные изделия"], nameEn: "Pasta, cooked, enriched, without added salt" };
  const parsnip = { nameRu: "Пастернак, варёный", aliases: ["parsnip", "корень пастернака"], nameEn: "Parsnips, cooked, boiled, drained, without salt" };
  const almondPaste = { nameRu: "Паста миндальная, без соли", aliases: ["миндальное масло", "almond butter", "миндальная паста"], nameEn: "Nuts, almond butter, plain, without salt added" };
  const creamCheese = { nameRu: "Сыр сливочный (крем-чиз)", aliases: ["филадельфия", "cream cheese", "крем-чиз", "творожный сыр", "сыр творожный", "сливочный сыр"], nameEn: "Cheese, cream" };
  const syrok = { nameRu: "Сырок творожный глазированный", aliases: ["сырок", "глазированный сырок"] };

  it("слова вида в запросе — подсказка, а не часть названия", () => {
    expect(parseQuery("сухой пасты")).toEqual({ tokens: ["сухой", "пасты"], core: ["пасты"], state: "raw" });
    expect(parseQuery("паста", "cooked")).toEqual({ tokens: ["паста"], core: ["паста"], state: "cooked" });
    expect(parseQuery("паста", "unknown").state).toBeNull();
    // Явная подсказка (вид от ИИ) важнее слов запроса.
    expect(parseQuery("рис отварной", "raw").state).toBe("raw");
  });

  it("«паста»: синоним целиком — exact, «Паста миндальная» — целое слово, «пастернак» — только префикс", () => {
    const q = parseQuery("паста");
    expect(matchFood(q, macaroniDry)).toMatchObject({ whole: 1, kind: "exact" });
    expect(matchFood(q, almondPaste)).toMatchObject({ whole: 1, kind: "words", nameStart: true });
    expect(matchFood(q, parsnip)).toMatchObject({ whole: 0, kind: "partial", prefixStart: true });
  });

  it("«творожный сыр»: сырок — другое слово, крем-чиз — синоним", () => {
    for (const text of ["творожный сыр", "сыр творожный", "творожного сыра"]) {
      const q = parseQuery(text);
      expect(matchFood(q, creamCheese).kind).toBe("exact");
      expect(matchFood(q, syrok)).toMatchObject({ whole: 1, kind: "partial" });
    }
  });

  it("вид: совпал +1, противоположный −1, не указан 0", () => {
    const raw = parseQuery("паста", "raw");
    expect(matchFood(raw, macaroniDry).state).toBe(1);
    expect(matchFood(raw, macaroniCooked).state).toBe(-1);
    expect(matchFood(raw, almondPaste).state).toBe(0);
    expect(matchFood(parseQuery("паста"), macaroniCooked).state).toBe(0);
    // «сухой пасты»: вид из запроса, ядро «пасты» совпадает с синонимом «паста»
    expect(matchFood(parseQuery("сухой пасты"), macaroniDry)).toMatchObject({ whole: 2, kind: "exact", state: 1 });
  });

  it("текст в скобках — уточнение, а не название: «(без мяса)» не равно «мясо»", () => {
    expect(matchFood(parseQuery("мясо"), { nameRu: "Бекон растительный (без мяса)" }).kind).toBe("words");
    expect(matchFood(parseQuery("жир"), { nameRu: "Телятина, рёбра (без жира), тушёная" }).kind).toBe("words");
    expect(matchFood(parseQuery("масло"), { nameRu: "Лецитин соевый (масло)" }).kind).toBe("words");
  });

  it("«сырая»/«варёная» в названии не мешают равенству, «сухое» — мешает", () => {
    const q = parseQuery("морковь");
    expect(matchFood(q, { nameRu: "Морковь сырая" }).kind).toBe("exact");
    expect(matchFood(q, { nameRu: "Морковь варёная, без соли" }).kind).toBe("exact");
    expect(matchFood(parseQuery("молоко"), { nameRu: "Молоко сухое" }).kind).toBe("words");
  });

  it("числа — отдельные слова: «сливки 20» не равно «сливки 10»", () => {
    const q = parseQuery("сливки 20");
    expect(matchFood(q, { nameRu: "Сливки 20%", aliases: ["сливки", "cream"] }).kind).toBe("exact");
    expect(matchFood(q, { nameRu: "Сливки 20% (кофейные)" }).kind).toBe("exact");
    expect(matchFood(q, { nameRu: "Сливки 10%", aliases: ["сливки", "cream"] }).whole).toBe(1);
  });
});

describe("tokenPattern — «целое слово» для SQL-регулярки", () => {
  const word = (t: string) => new RegExp(`(^| )${tokenPattern(t)}( |$)`);
  it("совпадает с формами слова и не совпадает с началом другого слова", () => {
    expect(word("пасты").test("макароны сухие паста спагетти")).toBe(true);
    expect(word("пасты").test("пастернак вареный parsnip")).toBe(false);
    expect(word("сыра").test("сыр гауда")).toBe(true);
    expect(word("сыр").test("сырок творожный")).toBe(false);
    expect(word("3.2").test("молоко 3.2 milk")).toBe(true);
    expect(word("3.2").test("молоко 342")).toBe(false);
    expect(word("cheese").test("cheeses cream")).toBe(true);
  });
});

describe("weakResults — когда сразу искать в Open Food Facts", () => {
  const hit = (match: MatchKind) => ({ match });
  it.each([
    ["пусто", [], true],
    ["только начала слов («паст|ернак»)", [hit("partial"), hit("partial"), hit("partial")], true],
    ["два варианта без точного", [hit("words"), hit("partial")], true],
    ["один точный — хватает («сыр гауда»)", [hit("exact")], false],
    ["три по целым словам", [hit("words"), hit("words"), hit("partial")], false],
  ] as const)("%s → %s", (_label, items, expected) => {
    expect(weakResults([...items])).toBe(expected);
  });
});
