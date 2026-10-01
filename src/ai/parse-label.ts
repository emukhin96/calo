// Фото этикетки → цифры пищевой ценности для своего продукта (OwnFoodSheet).
// Главный принцип (docs/ARCHITECTURE.md §1) не нарушается: ИИ не оценивает КБЖУ,
// а переписывает напечатанное; форма показывает цифры человеку на проверку.
// Нужен там, где товара нет в Open Food Facts: армянская молочка, местная
// выпечка, канадские этикетки «на порцию».
import { z } from "zod";
import type { AiImage, GenerateJson, JsonSchema } from "./gemini";
import { AiError } from "./gemini";

const num = z.number().min(0).max(5000).nullish();

export const LabelResult = z.object({
  /** Таблица пищевой ценности нашлась и читается. */
  found: z.boolean(),
  /** Название по-русски, коротко: «Йогурт греческий 2%». */
  name: z.string().trim().max(120).nullish(),
  brand: z.string().trim().max(80).nullish(),
  /** На что даны значения: на 100 г (мл) или на порцию. */
  basis: z.enum(["100g", "serving"]),
  /** Вес порции с этикетки, г (мл ≈ г). */
  servingG: z.number().positive().max(5000).nullish(),
  kcal: num,
  protein: num,
  fat: num,
  carbs: num,
});
export type LabelResult = z.infer<typeof LabelResult>;

/** Поле, которого на этикетке может не быть: JSON Schema, тип с null. */
const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

export const LABEL_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "есть ли на фото читаемая таблица пищевой ценности" },
    name: nullable("string", "название продукта по-русски, коротко"),
    brand: nullable("string", "бренд латиницей, как на упаковке"),
    basis: { type: "string", enum: ["100g", "serving"] },
    servingG: nullable("number", "вес порции в граммах (мл считать граммами)"),
    kcal: nullable("number", "энергия, ккал"),
    protein: nullable("number", "белки, г"),
    fat: nullable("number", "жиры, г"),
    carbs: nullable("number", "углеводы, г"),
  },
  required: ["found", "name", "brand", "basis", "servingG", "kcal", "protein", "fat", "carbs"],
};

export const LABEL_PROMPT = `Ты переписываешь таблицу пищевой ценности с фото упаковки продукта для дневника питания.
Ты НЕ оцениваешь и НЕ придумываешь цифры — только то, что напечатано на этикетке.

Правила:
1. Найди таблицу: «Пищевая ценность», «Nutrition Facts / Valeur nutritive», «Սննդային արժեք», «Valeurs nutritionnelles»
   и т. п. Нет таблицы или цифры не читаются — found=false, числа null.
2. basis — на что даны значения: 100g — «на 100 г», «на 100 мл», «per 100 g»; serving — «на порцию», «Per 1 cup (250 mL)»,
   «pour 2 biscuits (22 g)». Если есть обе колонки — бери 100 г.
3. servingG — вес порции в граммах из подписи порции (мл считай граммами). При basis=100g — вес порции, если он указан, иначе null.
4. kcal — энергия в килокалориях; если напечатаны только кДж — раздели на 4,184. protein, fat, carbs — граммы, как
   напечатано (углеводы = «углеводы», «carbohydrate», «glucides»; клетчатку не вычитай).
5. Проценты суточной нормы (% DV, % VQ, % РСП) — не граммы, их не бери. Не видно числа — null, не угадывай.
6. name — что это за продукт, по-русски и коротко, с жирностью, если она указана: «Йогурт греческий 2%», «Мацони 3,2%».
   brand — бренд латиницей, как на упаковке («Marianna», «Natrel»). Не видно — null.`;

/** Читает этикетку. gen подменяется в тестах. */
export async function parseLabel(image: AiImage, gen: GenerateJson): Promise<LabelResult> {
  const raw = await gen({ system: LABEL_PROMPT, user: "Перепиши пищевую ценность с этикетки на фото.", schema: LABEL_SCHEMA, image });
  const parsed = LabelResult.safeParse(raw);
  if (!parsed.success) throw new AiError("bad_response", `ответ ИИ не по схеме: ${parsed.error.issues[0]?.message ?? ""}`);
  const r = parsed.data;
  // Без калорий или без всех трёх БЖУ заполнять форму нечем.
  const usable = r.found && r.kcal != null && r.protein != null && r.fat != null && r.carbs != null;
  return usable ? r : { ...r, found: false };
}
