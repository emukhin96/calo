import { after } from "next/server";
import { aiEnabled, generateJson } from "@/ai/gemini";
import { isRussianName, translateFoodName } from "@/ai/translate-name";
import { takeAiRequest } from "@/ai/usage";
import { db } from "@/db";
import { type FoodResult, findOffFoodByBarcode, findOwnFoodByBarcode, getFood, renameOffFood, upsertFood } from "@/db/foods";
import { BARCODE_RE, expandUpcE } from "@/domain/barcode";
import { todayIn } from "@/domain/day";
import { apiSession } from "@/lib/api";
import { fetchOffProduct } from "@/lib/off";
import { userTimeZone } from "@/lib/tz";

/**
 * Товар не по-русски («Lori brine cheese», «Yogourt grec») — после ответа ИИ
 * переводит название (src/ai/translate-name.ts); в следующий раз товар
 * показывается и ищется по-русски. Запрос считается в дневной лимит ИИ.
 */
function translateLater(ownerId: string, food: FoodResult) {
  if (!aiEnabled() || isRussianName(food.nameRu)) return;
  after(async () => {
    try {
      if (!(await takeAiRequest(db, ownerId, todayIn(await userTimeZone(ownerId))))) return;
      const t = await translateFoodName(food.nameRu, food.brand, generateJson);
      await renameOffFood(db, food.id, t.nameRu, t.aliases);
    } catch (e) {
      console.warn("[ai] food name", e);
    }
  });
}

/**
 * GET /api/foods/barcode/4607004012044 — продукт по штрихкоду (сканер): сначала
 * свой («КБЖУ с упаковки», POST /api/foods), иначе свежий из Open Food Facts с
 * сохранением в справочник (source=off); OFF не ответил или товара там нет —
 * сохранённый раньше, если он есть. Чужие свои продукты не находятся.
 * Код в любом написании — один товар: UPC-A из 12 цифр и он же с нулём впереди,
 * восьмизначный UPC-E и развёрнутый из него UPC-A (src/domain/barcode.ts).
 *
 * ?source=off — именно товар OFF, без своего продукта: так сохраняется и
 * выбирается результат поиска в OFF (FoodSearch, PickFoodSheet, RecipeEditor).
 * Пользователь выбрал конкретный товар из списка — свой продукт с тем же
 * штрихкодом не должен молча его подменить. 404 и 502 — как без параметра.
 * Название не по-русски переводится после ответа (translateLater) и при
 * следующем обновлении из OFF не затирается.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/foods/barcode/[code]">) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const { code } = await ctx.params;
  if (!BARCODE_RE.test(code)) return Response.json({ error: "bad barcode" }, { status: 400 });

  const offOnly = new URL(req.url).searchParams.get("source") === "off";
  const own = offOnly ? null : await findOwnFoodByBarcode(db, session.user.id, code);
  if (own) return Response.json(own);

  const cached = await findOffFoodByBarcode(db, code);
  const cachedFood = async () => (cached ? Response.json(await getFood(db, session.user.id, cached.id)) : null);
  // Восьмизначный код без подсказки сканера может быть и EAN-8, и UPC-E.
  const upcA = code.length === 8 ? expandUpcE(code) : null;
  const tries = upcA ? [code, "0" + upcA] : [code];
  try {
    let product = null;
    for (const c of tries) {
      product = await fetchOffProduct(c);
      if (product) break;
    }
    if (!product) {
      return (await cachedFood()) ?? Response.json({ error: "not found" }, { status: 404 });
    }
    // Сохранённый раньше под другим написанием кода — та же строка справочника, а не копия.
    // Русское название, переведённое раньше, остаётся; название из OFF — синоним.
    const keepName = cached && isRussianName(cached.nameRu) && !isRussianName(product.nameRu);
    const saved = await upsertFood(db, {
      ...product,
      sourceRef: cached?.sourceRef ?? product.sourceRef,
      ...(keepName ? { nameRu: cached.nameRu, aliases: [...new Set([product.nameRu, ...(product.aliases ?? []), ...cached.aliases])] } : {}),
    });
    translateLater(session.user.id, saved);
    return Response.json(saved);
  } catch (e) {
    console.error("[off] product", e);
    return (await cachedFood()) ?? Response.json({ error: "Open Food Facts не отвечает" }, { status: 502 });
  }
}
