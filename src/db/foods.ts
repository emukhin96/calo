// Доступ к справочнику продуктов. Функции принимают db параметром — тесты
// гоняют их на PGlite в памяти (src/db/foods.test.ts).
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { barcodeVariants } from "@/domain/barcode";
import type { NutrientVector } from "@/domain/nutrients";
import { buildSearchText, type FoodState, type MatchKind, matchFood, parseQuery, stem, tokenPattern } from "@/domain/search";
import type { DB } from ".";
import { entries, foods } from "./schema";

export type FoodSource = (typeof foods.$inferSelect)["source"];

export type FoodResult = {
  id: string;
  nameRu: string;
  brand: string | null;
  source: FoodSource;
  sourceRef: string | null;
  own: boolean;
  nutrientsPer100g: NutrientVector;
  defaultPortionG: number | null;
  portionLabel: string | null;
};

const resultColumns = {
  id: foods.id,
  nameRu: foods.nameRu,
  brand: foods.brand,
  source: foods.source,
  sourceRef: foods.sourceRef,
  ownerId: foods.ownerId,
  nutrientsPer100g: foods.nutrientsPer100g,
  defaultPortionG: foods.defaultPortionG,
  portionLabel: foods.portionLabel,
};

type ResultRow = Omit<FoodResult, "own"> & { ownerId: string | null };

/**
 * Строка → FoodResult. У своего продукта со штрихкодом source_ref хранит
 * «владелец:код» (см. ownBarcodeRef) — наружу отдаём только код, как у OFF.
 */
function toResult({ ownerId, ...r }: ResultRow): FoodResult {
  const prefix = ownerId ? `${ownerId}:` : null;
  const sourceRef = prefix && r.sourceRef?.startsWith(prefix) ? r.sourceRef.slice(prefix.length) : r.sourceRef;
  return { ...r, sourceRef, own: ownerId != null };
}

/** Слово запроса «похоже» на текст продукта: подстрока или триграммное сходство слова. */
const WORD_SIMILARITY = 0.55;

/** Сколько кандидатов SQL отдаёт на точное ранжирование (matchFood). */
const POOL = 150;

/** Результат поиска: продукт + насколько он совпал с запросом (см. MatchKind). */
export type FoodHit = FoodResult & { match: MatchKind };

export type SearchHints = {
  /** Вид от ИИ («100 г сухой пасты» → raw): совпавший вид выше, противоположный ниже. */
  state?: FoodState | "unknown" | null;
};

/**
 * Поиск продуктов: общий справочник + личные продукты владельца.
 * Каждое слово запроса должно найтись (подстрокой или по сходству — опечатки,
 * падежи: «пармезана» → «пармезан»). Порядок:
 * 1) сколько слов нашлось целым словом в любой форме — «паста» (синоним макарон)
 *    выше «паст|ернака», «сыр» выше «сыр|ка»;
 * 2) свои продукты; 3) вид не противоречит подсказке (сухие / варёные);
 * 4) то, что пользователь уже записывал в дневник;
 * 5) название или синоним ровно равен запросу; 6) без добавки «с X», которой нет в
 *    запросе («Рис жареный с курицей» на «рис» — ниже риса); 7) название начинается
 *    с первого слова целиком; 8) вид совпал с подсказкой; 9) название начинается хотя
 *    бы с основы первого слова; 10) суммарное сходство; полнота данных (сколько
 *    нутриентов известно); короткие названия выше.
 * SQL отбирает POOL кандидатов грубо (целые слова — регуляркой), точный порядок — в JS.
 */
export async function searchFoods(
  db: DB,
  ownerId: string,
  query: string,
  limit = 30,
  hints: SearchHints = {},
): Promise<FoodHit[]> {
  const q = parseQuery(query, hints.state);
  const { tokens } = q;
  if (tokens.length === 0) return [];

  // Подстрокой ищем по основе слова (падежи: «сырой» ~ «сырые»), сходством — по слову целиком (опечатки).
  const perToken: SQL[] = tokens.map(
    (t) =>
      sql`(${foods.searchText} like ${"%" + stem(t) + "%"} or word_similarity(${t}, ${foods.searchText}) >= ${WORD_SIMILARITY})`,
  );
  const score = sql.join(
    tokens.map(
      (t) =>
        sql`greatest(word_similarity(${t}, ${foods.searchText}), case when ${foods.searchText} like ${"%" + stem(t) + "%"} then 1 else 0 end)`,
    ),
    sql` + `,
  );
  const whole = sql.join(
    tokens.map((t) => sql`(${foods.searchText} ~ ${`(^| )${tokenPattern(t)}( |$)`})::int`),
    sql` + `,
  );
  const startsWith = sql`(${foods.searchText} like ${stem(tokens[0]) + "%"})`;
  // Сколько раз ел (до 5) — одним проходом по записям владельца, а не подзапросом на каждую строку.
  const eatenBy = db
    .select({ foodId: entries.foodId, n: sql<number>`least(count(*), 5)::int`.as("n") })
    .from(entries)
    .where(eq(entries.ownerId, ownerId))
    .groupBy(entries.foodId)
    .as("eaten_by");
  const eaten = sql<number>`coalesce(${eatenBy.n}, 0)`;
  const completeness = sql<number>`(select count(*) from jsonb_each(${foods.nutrientsPer100g}) where value <> 'null'::jsonb)::int`;

  const rows = await db
    .select({
      food: resultColumns,
      aliases: foods.aliases,
      nameEn: foods.nameEn,
      eaten,
      completeness,
      score: sql<number>`(${score})::float8`,
    })
    .from(foods)
    .leftJoin(eatenBy, eq(eatenBy.foodId, foods.id))
    .where(and(or(isNull(foods.ownerId), eq(foods.ownerId, ownerId)), ...perToken))
    .orderBy(
      sql`(${whole}) desc`,
      sql`(${foods.ownerId} is not null) desc`,
      sql`${eaten} desc`,
      sql`${startsWith} desc`,
      sql`(${score}) desc`,
      sql`${completeness} desc`,
      sql`length(${foods.nameRu})`,
    )
    .limit(Math.max(POOL, limit));

  const flag = (x: boolean) => (x ? 1 : 0);
  return rows
    .map((r) => ({ ...r, m: matchFood(q, { ...r.food, aliases: r.aliases, nameEn: r.nameEn }) }))
    .sort(
      (a, b) =>
        b.m.whole - a.m.whole ||
        flag(b.food.ownerId != null) - flag(a.food.ownerId != null) ||
        // Противоположный вид — вниз, даже если его ели («сухой пасты» — не варёные макароны).
        flag(b.m.state >= 0) - flag(a.m.state >= 0) ||
        b.eaten - a.eaten ||
        flag(b.m.kind === "exact") - flag(a.m.kind === "exact") ||
        // «Рис жареный с курицей» — после риса: просили продукт, а не блюдо с ним.
        flag(a.m.withExtra) - flag(b.m.withExtra) ||
        flag(b.m.nameStart) - flag(a.m.nameStart) ||
        // Совпавший вид выбирает среди вариантов того же продукта, а не подменяет продукт:
        // «сосиски» (cooked) — сосиски, а не «Колбаса говяжья, жареная» с синонимом «сосиски».
        b.m.state - a.m.state ||
        flag(b.m.prefixStart) - flag(a.m.prefixStart) ||
        b.score - a.score ||
        b.completeness - a.completeness ||
        a.food.nameRu.length - b.food.nameRu.length,
    )
    .slice(0, limit)
    .map((r) => ({ ...toResult(r.food), match: r.m.kind }));
}

export type FoodUpsert = {
  source: FoodSource;
  sourceRef: string;
  nameRu: string;
  nameEn?: string | null;
  aliases?: string[];
  brand?: string | null;
  nutrientsPer100g: NutrientVector;
  defaultPortionG?: number | null;
  portionLabel?: string | null;
};

function toRow(f: FoodUpsert) {
  return {
    ownerId: null,
    source: f.source,
    sourceRef: f.sourceRef,
    nameRu: f.nameRu,
    nameEn: f.nameEn ?? null,
    aliases: f.aliases ?? [],
    brand: f.brand ?? null,
    nutrientsPer100g: f.nutrientsPer100g,
    defaultPortionG: f.defaultPortionG ?? null,
    portionLabel: f.portionLabel ?? null,
    searchText: buildSearchText(f),
  };
}

/** Вставка или обновление записей общего справочника по (source, source_ref). */
export async function upsertFoods(db: DB, items: FoodUpsert[], batchSize = 400): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const rows = items.slice(i, i + batchSize).map(toRow);
    await db
      .insert(foods)
      .values(rows)
      .onConflictDoUpdate({
        target: [foods.source, foods.sourceRef],
        set: {
          nameRu: sql`excluded.name_ru`,
          nameEn: sql`excluded.name_en`,
          aliases: sql`excluded.aliases`,
          brand: sql`excluded.brand`,
          nutrientsPer100g: sql`excluded.nutrients_per_100g`,
          defaultPortionG: sql`excluded.default_portion_g`,
          portionLabel: sql`excluded.portion_label`,
          searchText: sql`excluded.search_text`,
        },
      });
  }
}

export async function upsertFood(db: DB, item: FoodUpsert): Promise<FoodResult> {
  await upsertFoods(db, [item]);
  const [row] = await db
    .select(resultColumns)
    .from(foods)
    .where(and(eq(foods.source, item.source), eq(foods.sourceRef, item.sourceRef)));
  return toResult(row);
}

/** Продукт по id: общий или свой. */
export async function getFood(db: DB, ownerId: string, id: string): Promise<FoodResult | null> {
  const [row] = await db
    .select(resultColumns)
    .from(foods)
    .where(and(eq(foods.id, id), or(isNull(foods.ownerId), eq(foods.ownerId, ownerId))));
  return row ? toResult(row) : null;
}

export async function getFoods(db: DB, ownerId: string, ids: string[]): Promise<FoodResult[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select(resultColumns)
    .from(foods)
    .where(and(inArray(foods.id, ids), or(isNull(foods.ownerId), eq(foods.ownerId, ownerId))));
  return rows.map(toResult);
}

/**
 * source_ref своего продукта со штрихкодом. Уникальный индекс (source, source_ref)
 * общий на всех: у двух людей один и тот же йогурт не должен сталкиваться,
 * поэтому в ссылку входит владелец.
 */
export const ownBarcodeRef = (ownerId: string, code: string) => `${ownerId}:${code}`;

export type OwnFoodCreate = {
  nameRu: string;
  brand?: string | null;
  barcode?: string | null;
  nutrientsPer100g: NutrientVector;
  defaultPortionG?: number | null;
};

/**
 * Свой продукт «КБЖУ с упаковки» (source = manual). Со штрихкодом повторное
 * сохранение того же кода обновляет продукт, а не плодит копии — в каком бы
 * написании код ни сохранили раньше (UPC-A из 12 цифр и он же с нулём впереди —
 * один товар, src/domain/barcode.ts); без штрихкода — всегда новый продукт.
 * Ищется поиском, как и справочник (search_text).
 */
export async function createOwnFood(db: DB, ownerId: string, input: OwnFoodCreate): Promise<FoodResult> {
  const nameRu = input.nameRu.trim();
  const brand = input.brand?.trim() || null;
  const portion = input.defaultPortionG ?? null;
  const fields = {
    nameRu,
    brand,
    nutrientsPer100g: input.nutrientsPer100g,
    defaultPortionG: portion,
    portionLabel: portion ? `порция ${String(Math.round(portion * 10) / 10).replace(".", ",")} г` : null,
    searchText: buildSearchText({ nameRu, brand }),
  };
  const variants = input.barcode ? barcodeVariants(input.barcode) : [];
  const sourceRef = variants.length ? ownBarcodeRef(ownerId, variants[0]) : null;
  if (variants.length) {
    // Тот же товар под другим написанием кода — обновляем его и переводим на ключ.
    const [saved] = await db
      .update(foods)
      .set({ ...fields, sourceRef })
      .where(and(eq(foods.ownerId, ownerId), eq(foods.source, "manual"), inArray(foods.sourceRef, variants.map((c) => ownBarcodeRef(ownerId, c)))))
      .returning(resultColumns);
    if (saved) return toResult(saved);
  }
  const row = { ...fields, ownerId, source: "manual" as const, sourceRef, nameEn: null, aliases: [] };
  const [saved] = sourceRef
    ? await db
        .insert(foods)
        .values(row)
        .onConflictDoUpdate({
          target: [foods.source, foods.sourceRef],
          set: fields,
          // Ссылка и так содержит владельца; условие — страховка от чужой строки.
          setWhere: eq(foods.ownerId, ownerId),
        })
        .returning(resultColumns)
    : await db.insert(foods).values(row).returning(resultColumns);
  if (!saved) throw new Error("own food conflict");
  return toResult(saved);
}

/** Свой продукт владельца с этим штрихкодом (в любом написании кода); чужие не видны. */
export async function findOwnFoodByBarcode(db: DB, ownerId: string, code: string): Promise<FoodResult | null> {
  const refs = barcodeVariants(code).map((c) => ownBarcodeRef(ownerId, c));
  if (refs.length === 0) return null;
  const [row] = await db
    .select(resultColumns)
    .from(foods)
    .where(and(eq(foods.ownerId, ownerId), eq(foods.source, "manual"), inArray(foods.sourceRef, refs)))
    .limit(1);
  return row ? toResult(row) : null;
}

export type CachedOff = { id: string; sourceRef: string; nameRu: string; aliases: string[] };

/** Товар Open Food Facts, сохранённый раньше под любым написанием этого кода. */
export async function findOffFoodByBarcode(db: DB, code: string): Promise<CachedOff | null> {
  const variants = barcodeVariants(code);
  if (variants.length === 0) return null;
  const [row] = await db
    .select({ id: foods.id, sourceRef: foods.sourceRef, nameRu: foods.nameRu, aliases: foods.aliases })
    .from(foods)
    .where(and(eq(foods.source, "off"), isNull(foods.ownerId), inArray(foods.sourceRef, variants)))
    .limit(1);
  return row?.sourceRef ? { ...row, sourceRef: row.sourceRef } : null;
}

/**
 * Русское название товара OFF (src/ai/translate-name.ts): прежнее название и
 * синонимы остаются синонимами — товар ищется и так, и так. Только общий
 * справочник и только source = off.
 */
export async function renameOffFood(db: DB, id: string, nameRu: string, extraAliases: string[]): Promise<void> {
  const [row] = await db
    .select({ nameRu: foods.nameRu, aliases: foods.aliases, brand: foods.brand, nameEn: foods.nameEn })
    .from(foods)
    .where(and(eq(foods.id, id), eq(foods.source, "off"), isNull(foods.ownerId)));
  if (!row) return;
  const aliases = [...new Set([row.nameRu, ...row.aliases, ...extraAliases].filter((a) => a && a !== nameRu))];
  await db
    .update(foods)
    .set({ nameRu, aliases, searchText: buildSearchText({ nameRu, aliases, brand: row.brand, nameEn: row.nameEn }) })
    .where(eq(foods.id, id));
}
