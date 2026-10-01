import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { saveTemplate } from "@/db/recipes";
import { seedFoods } from "@/db/seed-foods";
import { createTestDb } from "@/test/db";
import { matchItems } from "./match";

let db: DB;
let close: () => Promise<void>;
const OWNER = "u1";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: OWNER, name: "U", email: "u@calo.test" });
  await seedFoods(db, path.resolve(__dirname, "../../seed/foods"));
});
afterAll(() => close());

describe("matchItems", () => {
  it("подбирает топ-3 кандидата и оставляет граммы", async () => {
    const [item] = await matchItems(db, OWNER, [{ name: "сливки 20%", amount: { grams: 50 }, sourceText: "50 г сливок 20%" }]);
    expect(item.grams).toBe(50);
    expect(item.candidates.length).toBeGreaterThan(0);
    expect(item.candidates.length).toBeLessThanOrEqual(3);
    expect(item.candidates[0].nameRu.toLowerCase()).toContain("сливки");
  });

  it("штуки переводит в граммы через порцию найденного продукта", async () => {
    const [egg] = await matchItems(db, OWNER, [{ name: "яйцо", amount: { pieces: 2 }, sourceText: "яйцо 2 шт" }]);
    expect(egg.pieces).toBe(2);
    if (egg.candidates[0]?.defaultPortionG) expect(egg.grams).toBe(2 * egg.candidates[0].defaultPortionG);
    else expect(egg.grams).toBeNull();
  });

  it("бренд не мешает найти продукт, длинное название — падает до ключевого слова", async () => {
    const [a, b] = await matchItems(db, OWNER, [
      { name: "творог 5%", brand: "Простоквашино", amount: { grams: 180 }, sourceText: "" },
      { name: "пармезан выдержанный тёртый", amount: { grams: 30 }, sourceText: "" },
    ]);
    expect(a.candidates[0].nameRu.toLowerCase()).toContain("творог");
    expect(b.candidates.some((c) => c.nameRu.toLowerCase().includes("пармезан"))).toBe(true);
  });

  // Пример из подсказки «паста: 100 г сухой пасты, …»: ИИ отдаёт «паста» + raw — был пастернак.
  it("«паста» + raw → «Макароны, сухие», без пастернака и пастромы", async () => {
    const [item] = await matchItems(db, OWNER, [{ name: "паста", state: "raw", amount: { grams: 100 }, sourceText: "100 г сухой пасты" }]);
    expect(item.candidates[0].nameRu).toBe("Макароны, сухие");
    expect(item.candidates.some((c) => /пастернак|пастрома/i.test(c.nameRu))).toBe(false);
    expect(item.state).toBe("raw");
  });

  it("вид решает: паста cooked → варёные, гречка cooked → варёная, гречка raw → сухая", async () => {
    const [pasta, buckCooked, buckRaw, rice] = await matchItems(db, OWNER, [
      { name: "паста", state: "cooked", amount: { grams: 200 }, sourceText: "" },
      { name: "гречка", state: "cooked", amount: { grams: 150 }, sourceText: "" },
      { name: "гречка", state: "raw", amount: { grams: 60 }, sourceText: "" },
      { name: "рис", state: "cooked", amount: { grams: 200 }, sourceText: "" },
    ]);
    expect(pasta.candidates[0].nameRu).toMatch(/^Макароны, варёные/);
    expect(buckCooked.candidates[0].nameRu).toMatch(/^Гречка.*варёная/);
    expect(buckRaw.candidates[0].nameRu).toMatch(/^Гречка.*сухая/);
    expect(rice.candidates[0].nameRu).toMatch(/^Рис .*варёный/);
  });

  it("вид не подменяет продукт: «два яблока» (raw) — свежие, не сушёные; сосиски (cooked) — сосиски", async () => {
    const [apples, sausages] = await matchItems(db, OWNER, [
      { name: "яблоко", nameEn: "apple, raw", state: "raw", amount: { grams: 360 }, sourceText: "два яблока" },
      { name: "сосиски", nameEn: "sausages", state: "cooked", amount: { grams: 100 }, sourceText: "" },
    ]);
    expect(apples.candidates[0].nameRu).toMatch(/^Яблоки, сырые/);
    expect(sausages.candidates.every((c) => c.nameRu.startsWith("Сосиски"))).toBe(true);
  });

  it("«творожный сыр» и «творожного сыра» (быстрый разбор) → сливочный сыр", async () => {
    const [a, b] = await matchItems(db, OWNER, [
      { name: "творожный сыр", amount: { grams: 30 }, sourceText: "" },
      { name: "творожного сыра", amount: { grams: 30 }, sourceText: "творожного сыра 30 г" },
    ]);
    expect(a.candidates[0].nameRu).toBe("Сыр сливочный (крем-чиз)");
    expect(b.candidates[0].nameRu).toBe("Сыр сливочный (крем-чиз)");
  });

  it("английское название от ИИ помогает, когда русское не нашлось целыми словами", async () => {
    const [withEn] = await matchItems(db, OWNER, [
      { name: "пармезан выдержанный тёртый", nameEn: "parmesan cheese, grated", amount: { grams: 30 }, sourceText: "" },
    ]);
    expect(withEn.candidates[0].nameRu).toMatch(/^Сыр пармезан, тёртый/);
    // …но не перебивает хорошее русское совпадение
    const [pasta] = await matchItems(db, OWNER, [
      { name: "паста", nameEn: "noodles", state: "raw", amount: { grams: 100 }, sourceText: "" },
    ]);
    expect(pasta.candidates[0].nameRu).toBe("Макароны, сухие");
  });

  it("несуществующий продукт — без кандидатов, граммы сохраняются", async () => {
    const [x] = await matchItems(db, OWNER, [{ name: "ъъъъъ", amount: { grams: 10 }, sourceText: "" }]);
    expect(x.candidates).toEqual([]);
    expect(x.grams).toBe(10);
  });

  // Аудит сценариев (Армения, Канада, блюда): похожее по одному слову или подстроке не
  // становится продуктом позиции само — экран подтверждения выбирает только найденное.
  it("нет в справочнике: только похожие, не найденные", async () => {
    const items = await matchItems(
      db,
      OWNER,
      [
        { name: "сыр лори", nameEn: "lori cheese" }, // было: «Сыр бри» по слову «сыр»
        { name: "матнакаш", nameEn: "armenian bread" },
        { name: "гата", nameEn: "gata pastry" },
        { name: "шелковица сушёная" }, // было: тофу
      ].map((i) => ({ ...i, amount: { grams: 200 }, sourceText: i.name })),
    );
    for (const item of items) {
      expect(item.candidates.every((c) => c.match === "partial"), item.name).toBe(true);
    }
  });

  it("блюда и местные продукты находятся сами (FNDDS, справочные записи OFF)", async () => {
    const cases: [string, RegExp][] = [
      ["оливье", /^Салат Оливье/], // было: «Масло оливковое» 884 ккал
      ["плов", /^Плов/], // было: мороженое
      ["долма", /^Долма/], // было: виноградные листья по синониму «для долмы»
      ["мацони", /^Мацони/], // было: мацовая мука
      ["мацун", /^Мацони/], // было: шпинат комацуна
      ["борщ", /^Борщ/], // было: хлеб Бородинский
      ["шаурма", /шаурма|Гирос/i],
      ["хачапури", /^Хачапури/],
      ["сыр чечил", /^Сыр Чечил/],
      ["суджук", /^Суджук/],
      ["шелковица", /^Шелковица/],
      ["курага", /^Абрикосы, сушёные$/],
      ["лазанья", /^Лазанья/],
      ["пицца", /^Пицца/], // было: пепперони (колбаса) по синониму «для пиццы»
      ["kraft dinner", /Kraft Dinner/],
    ];
    const items = await matchItems(db, OWNER, cases.map(([name]) => ({ name, amount: { grams: 200 }, sourceText: name })));
    items.forEach((item, i) => {
      expect(item.candidates[0]?.match, item.name).not.toBe("partial");
      expect(item.candidates[0]?.nameRu, item.name).toMatch(cases[i][1]);
    });
  });

  it("найденное целыми словами — выбирается: ишхан, брынза, айран по «тан»", async () => {
    const items = await matchItems(
      db,
      OWNER,
      ["ишхан", "брынза", "тан", "кленовый сироп"].map((name) => ({ name, amount: { grams: 50 }, sourceText: name })),
    );
    for (const item of items) expect(item.candidates[0]?.match, item.name).not.toBe("partial");
  });

  it("блюдо с добавкой не подменяет продукт: «рис» — рис, а не «Рис жареный с курицей»", async () => {
    const [rice, potato] = await matchItems(db, OWNER, [
      { name: "рис", state: "cooked", amount: { grams: 150 }, sourceText: "" },
      { name: "омлет", amount: { grams: 150 }, sourceText: "" },
    ]);
    expect(rice.candidates[0].nameRu).not.toMatch(/с курицей/);
    expect(potato.candidates[0].nameRu).not.toMatch(/ с (сыром|помидорами)/);
  });

  it("штуки похожего продукта не переводятся в граммы его порцией", async () => {
    const [x] = await matchItems(db, OWNER, [{ name: "сосиска в тесте", amount: { pieces: 2 }, sourceText: "" }]);
    expect(x.candidates[0]?.match).toBe("partial");
    expect(x.grams).toBeNull();
  });

  it("своё блюдо из «Блюд» — первым, раньше общего из справочника", async () => {
    await saveTemplate(db, OWNER, { name: "Борщ мамин", per100g: { kcal: 65, protein: 3, fat: 3, carbs: 6 }, defaultPortionG: 350 });
    const [borsch, soup] = await matchItems(db, OWNER, [
      { name: "борщ", amount: { pieces: 1 }, sourceText: "тарелка борща" },
      { name: "суп", amount: { grams: 300 }, sourceText: "" },
    ]);
    expect(borsch.candidates[0]).toMatchObject({ nameRu: "Борщ мамин", own: true });
    expect(borsch.candidates[0].recipeId).toBeTruthy();
    expect(borsch.grams).toBe(350); // одна порция своего блюда
    expect(borsch.candidates.some((c) => c.nameRu === "Борщ с мясом")).toBe(true); // общий — следом
    expect(soup.candidates.every((c) => !c.recipeId)).toBe(true); // «суп» — не «Борщ мамин»
  });
});
