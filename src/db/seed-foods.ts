// Загрузка базового справочника (seed/foods/*.json) в БД при старте сервера.
// Повторная загрузка только если файлы изменились (хэш в app_meta).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { NutrientVector } from "@/domain/nutrients";
import type { DB } from ".";
import { type FoodUpsert, upsertFoods } from "./foods";
import { appMeta } from "./schema";

type UsdaFood = { ref: string; category: string; nameEn: string; nutrients: NutrientVector };
type UsdaRu = { ref: string; ru: string; aliases: string[] };
export type StapleFood = {
  slug: string;
  nameRu: string;
  aliases: string[];
  nutrients: NutrientVector;
  products: number; // по скольким товарам OFF взята медиана
};

const META_KEY = "foods_seed_hash";

export function loadSeedFoods(dir: string): { items: FoodUpsert[]; hash: string } {
  const read = (f: string) => readFileSync(path.join(dir, f), "utf8");
  const files = ["usda.json", "usda.ru.json", "staples.json"].filter((f) => existsSync(path.join(dir, f)));
  const hash = createHash("sha256").update(files.map(read).join("\n")).digest("hex").slice(0, 16);

  const items: FoodUpsert[] = [];
  if (files.includes("usda.json")) {
    const ru = new Map<string, UsdaRu>(
      files.includes("usda.ru.json") ? (JSON.parse(read("usda.ru.json")) as UsdaRu[]).map((r) => [r.ref, r]) : [],
    );
    // Одинаковые русские названия у разных записей USDA путают поиск — оставляем
    // одну, из Foundation (более свежие данные), если она есть.
    const usda = (JSON.parse(read("usda.json")) as UsdaFood[]).sort(
      (a, b) => Number(b.ref.startsWith("fd:")) - Number(a.ref.startsWith("fd:")),
    );
    const seenNames = new Set<string>();
    for (const f of usda) {
      const tr = ru.get(f.ref);
      const key = (tr?.ru ?? f.nameEn).toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      items.push({
        source: "usda",
        sourceRef: f.ref,
        nameRu: tr?.ru ?? f.nameEn, // без перевода — хотя бы английское название
        nameEn: f.nameEn,
        aliases: tr?.aliases ?? [],
        nutrientsPer100g: f.nutrients,
      });
    }
  }
  if (files.includes("staples.json")) {
    for (const s of JSON.parse(read("staples.json")) as StapleFood[]) {
      items.push({
        source: "off",
        sourceRef: `staple:${s.slug}`,
        nameRu: s.nameRu,
        aliases: s.aliases,
        nutrientsPer100g: s.nutrients,
      });
    }
  }
  return { items, hash };
}

export async function seedFoods(db: DB, dir = path.join(process.cwd(), "seed/foods")): Promise<void> {
  if (!existsSync(dir)) return;
  const { items, hash } = loadSeedFoods(dir);
  const [current] = await db.select().from(appMeta).where(eq(appMeta.key, META_KEY));
  if (current?.value === hash) return;

  const started = Date.now();
  await upsertFoods(db, items);
  await db
    .insert(appMeta)
    .values({ key: META_KEY, value: hash })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: hash, updatedAt: new Date() } });
  console.log(`[db] foods seed ${hash}: ${items.length} items in ${Date.now() - started} ms`);
}
