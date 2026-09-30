// Доступ к справочнику продуктов. Функции принимают db параметром — тесты
// гоняют их на PGlite в памяти (src/db/foods.test.ts).
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { NutrientVector } from "@/domain/nutrients";
import { buildSearchText, queryTokens, stem } from "@/domain/search";
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

/**
 * Поиск продуктов: общий справочник + личные продукты владельца.
 * Каждое слово запроса должно найтись (подстрокой или по сходству — опечатки,
 * падежи: «пармезана» → «пармезан»). Сортировка: свои продукты; то, что
 * пользователь уже записывал в дневник; совпадение с началом названия;
 * суммарное сходство; полнота данных (сколько нутриентов известно);
 * короткие названия выше.
 */
export async function searchFoods(db: DB, ownerId: string, query: string, limit = 30): Promise<FoodResult[]> {
  const tokens = queryTokens(query);
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
  const startsWith = sql`(${foods.searchText} like ${stem(tokens[0]) + "%"})`;
  const eaten = sql`least((select count(*) from ${entries} where ${entries.ownerId} = ${ownerId} and ${entries.foodId} = ${foods.id}), 5)`;
  const completeness = sql`(select count(*) from jsonb_each(${foods.nutrientsPer100g}) where value <> 'null'::jsonb)`;

  const rows = await db
    .select(resultColumns)
    .from(foods)
    .where(and(or(isNull(foods.ownerId), eq(foods.ownerId, ownerId)), ...perToken))
    .orderBy(
      sql`(${foods.ownerId} is not null) desc`,
      sql`${eaten} desc`,
      sql`${startsWith} desc`,
      sql`(${score}) desc`,
      sql`${completeness} desc`,
      sql`length(${foods.nameRu})`,
    )
    .limit(limit);

  return rows.map(toResult);
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
 * сохранение того же кода обновляет продукт, а не плодит копии; без штрихкода —
 * всегда новый продукт. Ищется поиском, как и справочник (search_text).
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
  const row = {
    ...fields,
    ownerId,
    source: "manual" as const,
    sourceRef: input.barcode ? ownBarcodeRef(ownerId, input.barcode) : null,
    nameEn: null,
    aliases: [],
  };
  const [saved] = row.sourceRef
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

/** Свой продукт владельца с этим штрихкодом; чужие не видны. */
export async function findOwnFoodByBarcode(db: DB, ownerId: string, code: string): Promise<FoodResult | null> {
  const [row] = await db
    .select(resultColumns)
    .from(foods)
    .where(and(eq(foods.ownerId, ownerId), eq(foods.source, "manual"), eq(foods.sourceRef, ownBarcodeRef(ownerId, code))));
  return row ? toResult(row) : null;
}
