// Клиент Open Food Facts на подменённом fetch: названия и языки, этикетки,
// поиск с брендом, страной, транслитом и отсевом нерелевантного.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeEntities, fetchOffProduct, offNames, searchOff } from "./off";

type Hit = Record<string, unknown>;
const yogurt = { "energy-kcal_100g": 60, proteins_100g: 3, fat_100g: 3.2, carbohydrates_100g: 4.5 };

let requests: URL[] = [];
/** Ответ поиска по тексту запроса q (без фильтра страны) и с фильтром. */
function stubSearch(byQuery: (q: string, country: string | null) => Hit[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      const q = url.searchParams.get("q") ?? "";
      const m = q.match(/ countries_tags:"en:([a-z-]+)"$/);
      const hits = byQuery(m ? q.slice(0, m.index) : q, m?.[1] ?? null);
      return new Response(JSON.stringify({ hits }), { status: 200 });
    }),
  );
}

beforeEach(() => {
  requests = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("названия товара", () => {
  it("русское → английское → основное; остальные — синонимы", () => {
    expect(offNames({ product_name: "Yogourt grec nature", product_name_en: "Plain Greek yogurt", product_name_fr: "Yogourt grec nature" })).toEqual([
      "Plain Greek yogurt",
      "Yogourt grec nature",
    ]);
    expect(offNames({ product_name: "Մածուն", product_name_ru: "Мацун" })).toEqual(["Мацун", "Մածուն"]);
  });

  it("HTML-сущности", () => {
    expect(decodeEntities("Sauce &gt; poutine")).toBe("Sauce > poutine");
    expect(decodeEntities("Джелато &quot;Пломбир&quot; &amp; ягоды &#233;")).toBe('Джелато "Пломбир" & ягоды é');
  });
});

describe("fetchOffProduct", () => {
  function stubProduct(product: Hit | null) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(product ? { status: 1, product } : { status: 0 }))));
  }

  it("ключ — канонический код, бренд — синонимы по словарю", async () => {
    stubProduct({ product_name: "Sour Cream 18%", brands: "Marianna", nutriments: { "energy-kcal_100g": 184, proteins_100g: 2.8, fat_100g: 18, carbohydrates_100g: 3 } });
    const f = await fetchOffProduct("4850001260066");
    expect(f).toMatchObject({ sourceRef: "4850001260066", nameRu: "Sour Cream 18%", brand: "Marianna" });
    expect(f!.aliases).toEqual(expect.arrayContaining(["Марианна", "Մարիաննա"]));

    stubProduct({ product_name: "Kraft Dinner", brands: "Kraft", nutriments: { "energy-kcal_100g": 370, proteins_100g: 12, fat_100g: 4, carbohydrates_100g: 70, potassium_100g: 0.3, iron_100g: 0.0035 } });
    const kd = await fetchOffProduct("068100058925");
    expect(kd).toMatchObject({ sourceRef: "0068100058925", nutrientsPer100g: { potassium: 300, iron: 3.5 } });
  });

  it("неизвестный код — OFF отвечает 404: это «нет товара», а не сбой", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: 0, status_verbose: "product not found" }), { status: 404 })));
    expect(await fetchOffProduct("4850001002556")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 503 })));
    await expect(fetchOffProduct("4850001002556")).rejects.toThrow(/503/);
  });

  it("коньяк со спиртом в % об. — сходится; канадские углеводы с клетчаткой — тоже", async () => {
    stubProduct({ product_name: "Ararat 5*", nutriments: { "energy-kcal_100g": 231, proteins_100g: 0, fat_100g: 0, carbohydrates_100g: 0, alcohol_100g: 40 } });
    expect(await fetchOffProduct("4850011000001")).not.toBeNull();
    stubProduct({ product_name: "Brown lentils", nutriments: { "energy-kcal_100g": 170, proteins_100g: 13, fat_100g: 1, carbohydrates_100g: 29, fiber_100g: 15 } });
    expect(await fetchOffProduct("87260403")).not.toBeNull();
  });
});

describe("searchOff", () => {
  it("отсеивает товары, где слов запроса нет: «сыр лори» — не любой сыр", async () => {
    stubSearch(() => [
      { code: "4607070735793", product_name: "Сыр полутвердый башкирский", nutriments: yogurt },
      { code: "4850001000013", product_name: "Сыр Лори", nutriments: yogurt },
    ]);
    expect((await searchOff("сыр лори")).map((f) => f.nameRu)).toEqual(["Сыр Лори"]);
  });

  it("бренд из словаря: «Марианна» — армянская Marianna, а не майонез «Марианна»", async () => {
    stubSearch((q) =>
      q === "сметана Marianna"
        ? [
            { code: "8586002391121", product_name: "Chia Seeds", brands: "Marianna", nutriments: yogurt },
            { code: "4850001260066", product_name: "Sour Cream 18%", brands: "Marianna", nutriments: yogurt },
            { code: "4850001261612", product_name: "Сметана 20%", brands: "Marianna", nutriments: yogurt },
            { code: "4607016942513", product_name: "Майонезный соус", brands: "Марианна-Россия", nutriments: yogurt },
          ]
        : [],
    );
    const found = await searchOff("Марианна сметана");
    // «сметана» по-английски — «sour cream»: оба выше; товар бренда без сметаны — ниже, чужой бренд — нет.
    expect(found.map((f) => f.nameRu)).toEqual(["Sour Cream 18%", "Сметана 20%", "Chia Seeds"]);
    expect(requests[0].searchParams.get("q")).toBe("сметана Marianna");
  });

  it("Канада: русский запрос без местных товаров — ещё раз по-английски, только местные", async () => {
    stubSearch((q, country) =>
      q === "yogurt greek" && country === "canada"
        ? [{ code: "0056800664836", product_name: "Yogourt grec nature", brands: "Danone", countries_tags: ["en:canada"], nutriments: yogurt }]
        : q === "йогурт греческий" && !country
          ? [{ code: "4610117743941", product_name: "Йогурт греческий", brands: "Сернур", countries_tags: ["en:russia"], nutriments: yogurt }]
          : [],
    );
    const found = await searchOff("йогурт греческий", { country: { tag: "canada", langs: ["fr"] } });
    expect(found.map((f) => [f.nameRu, f.local])).toEqual([
      ["Yogourt grec nature", true],
      ["Йогурт греческий", false],
    ]);
    // Английский заход — только с фильтром страны: остальной мир уже искали по-русски.
    const english = requests.filter((u) => u.searchParams.get("q")?.startsWith("yogurt greek"));
    expect(english.map((u) => u.searchParams.get("q"))).toEqual(['yogurt greek countries_tags:"en:canada"']);
  });

  it("страна: местные товары первыми, местный язык в langs", async () => {
    stubSearch((q, country) => [
      ...(country === "canada" ? [{ code: "0056800664836", product_name_fr: "Yogourt grec", product_name: "Yogourt grec", brands: "Danone", countries_tags: ["en:canada"], nutriments: yogurt }] : []),
      { code: "8424395141469", product_name: "Yogourt Grec", brands: "La Fageda", countries_tags: ["en:spain"], nutriments: yogurt },
      { code: "0056800664836", product_name: "Yogourt grec", brands: "Danone", countries_tags: ["en:canada"], nutriments: yogurt },
    ]);
    const found = await searchOff("yogourt grec", { country: { tag: "canada", langs: ["fr"] } });
    expect(found.map((f) => [f.brand, f.local])).toEqual([
      ["Danone", true],
      ["La Fageda", false],
    ]);
    expect(requests.every((u) => u.searchParams.get("langs") === "ru,en,fr")).toBe(true);
  });

  it("дубли кода с нулём впереди и без — один товар; без штрихкода — не показываем", async () => {
    stubSearch(() => [
      { code: "068100058925", product_name: "Kraft Dinner", nutriments: yogurt },
      { code: "0068100058925", product_name: "Kraft Dinner", nutriments: yogurt },
      { code: "3118", product_name: "Kraft Dinner pears", nutriments: yogurt },
    ]);
    const found = await searchOff("kraft dinner");
    expect(found).toHaveLength(1);
    expect(found[0].code).toBe("068100058925");
  });

  it("кириллица без результата — ещё раз латиницей", async () => {
    stubSearch((q) => (q === "matsun" ? [{ code: "4850003100087", product_name: "Matsun 3.2%", brands: "Ani", nutriments: yogurt }] : []));
    const found = await searchOff("мацун");
    expect(found.map((f) => f.nameRu)).toEqual(["Matsun 3.2%"]);
    expect(requests.map((u) => u.searchParams.get("q"))).toEqual(["мацун", "matsun"]);
  });

  it("второй заход: «сыр лори» → «cheese lori», слово не из словаря — латиницей", async () => {
    stubSearch((q) => (q === "cheese lori" ? [{ code: "4850001262640", product_name: "Lori brine cheese", brands: "Marianna", nutriments: yogurt }] : []));
    expect((await searchOff("сыр лори")).map((f) => f.nameRu)).toEqual(["Lori brine cheese"]);
  });

  it("сбой местного поиска не роняет обычный", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        n++;
        if (new URL(input).searchParams.get("q")?.includes("countries_tags")) return new Response("busy", { status: 503 });
        return new Response(JSON.stringify({ hits: [{ code: "4850001261612", product_name: "Кефир", nutriments: yogurt }] }));
      }),
    );
    expect((await searchOff("кефир", { country: { tag: "armenia", langs: ["hy"] } })).map((f) => f.nameRu)).toEqual(["Кефир"]);
    expect(n).toBeGreaterThanOrEqual(2);
  });
});
