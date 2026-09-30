import { z } from "zod";
import { db } from "@/db";
import { createOwnFood } from "@/db/foods";
import { apiSession } from "@/lib/api";
import { BARCODE_RE, OWN_FOOD_LIMITS as L, ownFoodErrors } from "@/lib/own-food";

// Пустое поле формы — «не указано».
const Blank = z.literal("").transform(() => null);

const CreateBody = z
  .object({
    nameRu: z.string().trim().min(1).max(L.name),
    brand: z.string().trim().max(L.brand).nullish(),
    barcode: z.string().regex(BARCODE_RE).nullish().or(Blank),
    per100g: z.object({
      kcal: z.number().min(0).max(L.kcal),
      protein: z.number().min(0).max(L.macro),
      fat: z.number().min(0).max(L.macro),
      carbs: z.number().min(0).max(L.macro),
    }),
    defaultPortionG: z.number().positive().max(L.portion).nullish(),
  })
  // Те же правила, что у формы (сумма БЖУ и т. п.).
  .refine((b) => Object.keys(ownFoodErrors(b)).length === 0, "bad values");

/**
 * POST /api/foods { nameRu, brand?, barcode?, per100g: { kcal, protein, fat, carbs }, defaultPortionG? }
 * — свой продукт «КБЖУ с упаковки». Ответ — как элемент /api/foods/search.
 * Со штрихкодом продукт потом находится сканером (/api/foods/barcode/…) раньше OFF.
 */
export async function POST(req: Request) {
  const { session, error } = await apiSession(req);
  if (error) return error;
  const body = CreateBody.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad request", issues: body.error.issues }, { status: 400 });
  const { per100g, ...rest } = body.data;
  const food = await createOwnFood(db, session.user.id, { ...rest, nutrientsPer100g: per100g });
  return Response.json(food, { status: 201 });
}
