// Название товара из Open Food Facts → по-русски. Армянские товары там чаще
// подписаны по-английски («Lori brine cheese»), канадские — по-французски
// («Yogourt grec nature»): в дневнике и в поиске по-русски их не видно.
// ИИ переводит только название; цифры остаются с этикетки.
import { z } from "zod";
import type { GenerateJson, JsonSchema } from "./gemini";
import { AiError } from "./gemini";

export const NameResult = z.object({
  nameRu: z.string().trim().min(1).max(120),
  /** Как ещё это ищут по-русски: «сыр лори», «рассольный сыр». */
  aliases: z.array(z.string().trim().min(1).max(60)).max(4),
});
export type NameResult = z.infer<typeof NameResult>;

export const NAME_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    nameRu: { type: "string", description: "название по-русски, как в справочнике продуктов" },
    aliases: { type: "array", maxItems: 4, items: { type: "string" }, description: "как ещё это ищут по-русски" },
  },
  required: ["nameRu", "aliases"],
};

export const NAME_PROMPT = `Ты переводишь на русский название товара из магазина для дневника питания.
Правила:
1. nameRu — что это за продукт, коротко, как в справочнике продуктов: «Сыр Лори рассольный», «Йогурт греческий
   натуральный 0%», «Компот из белой черешни». Жирность, вкус и вид оставляй; бренд в название не включай.
2. Армянские, грузинские и другие местные названия пиши, как их пишут по-русски: «matsun» → «мацун»,
   «gata» → «гата», «lavash» → «лаваш».
3. aliases — до 4 коротких вариантов, как этот продукт ищут по-русски («сыр лори», «рассольный сыр»), без бренда.
4. Не придумывай состав и свойства, которых нет в названии.`;

/** Перевод названия. gen подменяется в тестах. */
export async function translateFoodName(name: string, brand: string | null, gen: GenerateJson): Promise<NameResult> {
  const user = brand ? `${name}\nБренд: ${brand}` : name;
  const raw = await gen({ system: NAME_PROMPT, user: user.slice(0, 300), schema: NAME_SCHEMA });
  const parsed = NameResult.safeParse(raw);
  if (!parsed.success) throw new AiError("bad_response", `ответ ИИ не по схеме: ${parsed.error.issues[0]?.message ?? ""}`);
  return parsed.data;
}

/** В названии есть кириллица — переводить не нужно. */
export const isRussianName = (name: string) => /[а-яё]/i.test(name);
