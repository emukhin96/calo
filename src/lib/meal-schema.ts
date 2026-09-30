import { z } from "zod";
import { MEAL_NAME_MAX } from "@/domain/meals";

/**
 * Название приёма пищи в теле запроса (POST /api/entries, PATCH /api/entries/:id,
 * PATCH /api/meals/:id). 40 знаков отрежет normalizeMealName по кодовым точкам,
 * здесь — только потолок в единицах UTF-16: эмодзи — две единицы .length, и
 * 40 эмодзи должны пройти.
 */
export const MealNameField = z.string().trim().min(1).max(MEAL_NAME_MAX * 2);
