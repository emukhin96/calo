import { z } from "zod";

const Name = z.string().trim().min(1).max(120);
const Grams = z.number().positive().max(10000);

export const CompositeBody = z.object({
  kind: z.literal("composite"),
  name: Name,
  ingredients: z.array(z.object({ foodId: z.uuid(), grams: Grams })).min(1).max(60),
  totalWeightG: Grams.nullable().optional(),
  portions: z.number().int().min(1).max(50).nullable().optional(),
});

export const TemplateBody = z.object({
  kind: z.literal("template"),
  name: Name,
  // КБЖУ на 100 г; витамины для шаблона неизвестны.
  per100g: z.object({
    kcal: z.number().min(0).max(900),
    protein: z.number().min(0).max(100),
    fat: z.number().min(0).max(100),
    carbs: z.number().min(0).max(100),
  }),
  defaultPortionG: Grams.nullable().optional(),
});

export const RecipeBody = z.discriminatedUnion("kind", [CompositeBody, TemplateBody]);
