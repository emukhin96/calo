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

/** Приём своего списка: название и «скрыт» — не предлагается при добавлении еды. */
export const MealPlanItemBody = z.object({ name: z.string().max(200), hidden: z.boolean().optional() });

/**
 * Настройки приёмов пищи (PUT /api/profile/meals): items — весь список по
 * порядку с признаком «скрыт» (нормализует domain/meals.ts normalizeMealPlanItems:
 * 1–12 названий, хотя бы одно не скрыто); plan — старые клиенты: список названий,
 * все видны (normalizeMealPlan). items и plan вместе — нельзя.
 */
export const MealSettingsBody = z
  .object({
    items: z.array(MealPlanItemBody).min(1).max(40).optional(),
    plan: z.array(z.string().max(200)).min(1).max(40).optional(),
    showTimes: z.boolean().optional(),
  })
  .refine((b) => b.items != null || b.plan != null || b.showTimes != null)
  .refine((b) => b.items == null || b.plan == null);
