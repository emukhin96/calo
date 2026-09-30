import { z } from "zod";
import { isValidTimeZone } from "@/domain/day";
import { NUTRIENT_KEYS } from "@/domain/nutrients";

const thisYear = new Date().getUTCFullYear();

export const WeightKg = z.number().min(30).max(300);

/** Онбординг и настройки присылают одно и то же: профиль + цель (+ вес). */
export const ProfileBody = z.object({
  sex: z.enum(["female", "male"]),
  birthYear: z.number().int().min(thisYear - 100).max(thisYear - 18),
  heightCm: z.number().min(120).max(230),
  activity: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  timezone: z.string().refine(isValidTimeZone),
  goal: z.object({
    kind: z.enum(["lose", "maintain", "gain"]),
    rateKgPerWeek: z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75)]).nullable(),
    targetWeightKg: WeightKg.nullable(),
  }),
  weightKg: WeightKg.optional(),
});

export const OverrideBody = z.object({
  nutrient: z.enum(NUTRIENT_KEYS),
  value: z.number().positive().max(100000).nullable(),
});

/** Настройки приёмов пищи (PUT /api/profile/meals); plan нормализует domain/meals.ts normalizeMealPlan. */
export const MealSettingsBody = z
  .object({
    plan: z.array(z.string().max(200)).min(1).max(40).optional(),
    showTimes: z.boolean().optional(),
  })
  .refine((b) => b.plan != null || b.showTimes != null);
