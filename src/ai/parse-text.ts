// Разбор свободного текста «что съел» в список {продукт, граммы}.
// Главный принцип (docs/ARCHITECTURE.md §1): ИИ не придумывает КБЖУ — только
// позиции и вес; нутриенты потом берёт из справочника matcher (src/ai/match.ts).
import { z } from "zod";
import type { GenerateJson, JsonSchema } from "./gemini";
import { AiError } from "./gemini";

export const AiItem = z.object({
  /** Обобщённое название в именительном падеже, как в справочнике: «сливки 20%», «пармезан». */
  name: z.string().trim().min(1).max(80),
  /**
   * То же название по-английски, как в USDA: «pasta, dry», «cream cheese». Запасной
   * запрос к справочнику (src/ai/match.ts). Необязательное: старые ответы без него
   * проходят, лишнее обрезается — из-за подсказки разбор не должен падать.
   */
  nameEn: z
    .string()
    .nullish()
    .transform((s) => (s ?? "").trim().slice(0, 80)),
  /** Бренд отдельно, если назван; иначе пустая строка. */
  brand: z.string().trim().max(60),
  grams: z.number().min(1).max(5000),
  /** raw — сырое/сухое, cooked — готовое; важно для круп, пасты, мяса. */
  state: z.enum(["raw", "cooked", "unknown"]),
  /** Уверенность в весе: явно указан — ~1, «немного/тарелка» — ниже. */
  confidence: z.number().min(0).max(1),
  /** Кусок исходного текста, из которого позиция взята. */
  sourceText: z.string().trim().max(200),
});
export type AiItem = z.infer<typeof AiItem>;

export const AiResult = z.object({ items: z.array(AiItem).max(20) });

/** Схема для responseJsonSchema Gemini — вручную, без $schema/additionalProperties, которые API не принимает. */
export const AI_RESULT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "название продукта в именительном падеже, обобщённо, без бренда" },
          nameEn: { type: "string", description: "то же название по-английски, как в базе USDA: «pasta, dry», «cream cheese»" },
          brand: { type: "string", description: "бренд или пустая строка" },
          grams: { type: "number", description: "вес в граммах (мл считать граммами)" },
          state: { type: "string", enum: ["raw", "cooked", "unknown"] },
          confidence: { type: "number", description: "уверенность в весе от 0 до 1" },
          sourceText: { type: "string", description: "фрагмент исходного текста этой позиции" },
        },
        required: ["name", "nameEn", "brand", "grams", "state", "confidence", "sourceText"],
      },
    },
  },
  required: ["items"],
};

export const SYSTEM_PROMPT = `Ты разбираешь описание съеденного на русском языке в список продуктов с весом в граммах для дневника питания.
Ты НЕ оцениваешь калории и нутриенты — только продукты и их вес.

Правила:
1. Каждый продукт — отдельная позиция. Составное блюдо, названное одним словом с весом («борщ 300», «оливье 200»), — одна позиция.
   Если перечислены ингредиенты («паста: 100 г сухой пасты, 50 г сливок 20%, 30 г пармезана») — позиция на каждый ингредиент.
2. name — обобщённое название в именительном падеже единственного числа, как в справочнике продуктов:
   «сливки 20%», «творог 5%», «пармезан», «куриная грудка», «паста», «гречка», «яйцо куриное», «хлеб ржаной».
   Жирность и сорт оставляй в названии. Бренд («Простоквашино», «Rummo») — в поле brand, не в name.
   nameEn — то же по-английски, коротко, как в базе USDA, с видом, если он ясен: «pasta, dry», «cream cheese»,
   «buckwheat groats, cooked», «chicken breast, roasted», «cottage cheese» (для творога), «sour cream».
3. grams — вес в граммах. Миллилитры считай граммами. Переводи бытовые меры:
   стакан 250, кружка 300, чайная ложка 5, столовая ложка 15 (масло 17, мёд 20), ломтик хлеба 30, яйцо 55,
   банан 120, яблоко 180, апельсин 150, помидор 120, огурец 100, картофелина 100, куриная грудка 200,
   тарелка супа 300, порция гарнира 150, порция мяса 150, горсть орехов 30, кусок сыра 30, кусок торта 120.
   Множители: «два», «пара», «половина», «полкило» и т. п.
4. state — raw для сырого и сухого (крупа, паста до варки, сырое мясо), cooked — для готового (варёная гречка,
   готовая паста, жареная курица); если по тексту не ясно — unknown. Для «гречка 200» без пояснения ставь cooked:
   в тарелке обычно готовая. «100 г сухой пасты» — raw.
5. confidence — уверенность в весе: число указано — 0.9–1; бытовая мера — 0.6–0.8; «немного», «тарелка», нет
   количества — 0.3–0.5.
6. sourceText — фрагмент исходного текста, из которого взята позиция.
7. Напитки без калорий (вода, чай и кофе без сахара и молока) не включай. Не добавляй продуктов, которых нет в тексте.
8. Если текст не про еду или пустой — верни пустой список items.`;

/** Разбор текста через ИИ. gen подменяется в тестах. */
export async function parseFoodText(text: string, gen: GenerateJson): Promise<AiItem[]> {
  const raw = await gen({ system: SYSTEM_PROMPT, user: text.trim().slice(0, 1000), schema: AI_RESULT_SCHEMA });
  const parsed = AiResult.safeParse(raw);
  if (!parsed.success) throw new AiError("bad_response", `ответ ИИ не по схеме: ${parsed.error.issues[0]?.message ?? ""}`);
  return parsed.data.items.map((i) => ({ ...i, grams: Math.round(i.grams) }));
}
