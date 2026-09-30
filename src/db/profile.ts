// Профиль, цель, вес и ручные нормы. Цель и вес — история (новая строка на
// каждое изменение), текущие значения — последние строки. ARCHITECTURE.md §4.
import { and, desc, eq } from "drizzle-orm";
import { DEFAULT_MEAL_PLAN, hiddenNames, type MealPlanItem, planItems, visiblePlan } from "@/domain/meals";
import type { NutrientKey } from "@/domain/nutrients";
import type { Activity, GoalKind, Sex } from "@/domain/norms";
import type { DB } from ".";
import { NotFoundError } from "./errors";
import type { Conn } from "./meals";
import { goals, normsOverride, profiles, weightLog } from "./schema";

export type ProfileInput = {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  activity: Activity;
  timezone: string;
};
export type GoalInput = { kind: GoalKind; rateKgPerWeek: number | null; targetWeightKg: number | null };

export type UserState = {
  profile: (ProfileInput & { onboardedAt: Date | null }) | null;
  goal: GoalInput | null;
  weight: { kg: number; measuredAt: Date } | null;
  overrides: Partial<Record<NutrientKey, number>>;
  /** Приёмы пищи, которые предлагаются при добавлении еды, — по порядку, без скрытых (до онбординга — по умолчанию). */
  mealPlan: string[];
  /** Свой список приёмов целиком, по порядку, с признаком «скрыт» — Профиль → «Приёмы пищи». */
  mealItems: MealPlanItem[];
  /** Показывать время приёмов пищи. */
  showMealTimes: boolean;
};

/**
 * Настройки приёмов пищи из Профиля: plan — названия, которые предлагаются при
 * добавлении еды (по порядку, без скрытых); items — весь список по порядку с
 * признаком «скрыт» (по нему встают новые приёмы дня, скрытые тоже); показ времени.
 */
export type MealSettings = { plan: string[]; items: MealPlanItem[]; showTimes: boolean };

/** Список приёмов из строки профиля (нет профиля или список пуст — по умолчанию). */
function mealItemsOf(p: { plan: string[] | null; hidden: string[] | null } | undefined): MealPlanItem[] {
  return planItems(p?.plan?.length ? p.plan : DEFAULT_MEAL_PLAN, p?.hidden ?? []);
}

export async function getUserState(db: DB, ownerId: string): Promise<UserState> {
  const [[p], [g], [w], overrides] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.ownerId, ownerId)),
    db.select().from(goals).where(eq(goals.ownerId, ownerId)).orderBy(desc(goals.validFrom)).limit(1),
    db.select().from(weightLog).where(eq(weightLog.ownerId, ownerId)).orderBy(desc(weightLog.measuredAt)).limit(1),
    db.select().from(normsOverride).where(eq(normsOverride.ownerId, ownerId)),
  ]);
  const mealItems = mealItemsOf(p && { plan: p.mealPlan, hidden: p.mealPlanHidden });
  return {
    profile: p
      ? { sex: p.sex, birthYear: p.birthYear, heightCm: p.heightCm, activity: p.activity, timezone: p.timezone, onboardedAt: p.onboardedAt }
      : null,
    goal: g ? { kind: g.kind, rateKgPerWeek: g.rateKgPerWeek, targetWeightKg: g.targetWeightKg } : null,
    weight: w ? { kg: w.weightKg, measuredAt: w.measuredAt } : null,
    overrides: Object.fromEntries(overrides.map((o) => [o.nutrient, o.value])),
    mealPlan: visiblePlan(mealItems),
    mealItems,
    showMealTimes: p?.showMealTimes ?? false,
  };
}

const mealColumns = { plan: profiles.mealPlan, hidden: profiles.mealPlanHidden, showTimes: profiles.showMealTimes };

const toSettings = (p: { plan: string[] | null; hidden: string[] | null; showTimes: boolean } | undefined): MealSettings => {
  const items = mealItemsOf(p);
  return { plan: visiblePlan(items), items, showTimes: p?.showTimes ?? false };
};

/** Список приёмов (видимые и весь) и показ времени; профиля ещё нет — по умолчанию. */
export async function getMealSettings(db: Conn, ownerId: string): Promise<MealSettings> {
  const [p] = await db.select(mealColumns).from(profiles).where(eq(profiles.ownerId, ownerId));
  return toSettings(p);
}

/**
 * Что сохранить в настройках приёмов: items — весь список с признаком «скрыт»
 * (уже нормализованный, domain/meals.ts normalizeMealPlanItems); plan — старые
 * клиенты: список без скрытых (normalizeMealPlan), все приёмы в нём видны.
 */
export type MealSettingsInput = { items?: MealPlanItem[]; plan?: string[]; showTimes?: boolean };

/**
 * Сохранить настройки приёмов. Приёмы в уже заполненных днях не меняются.
 * Профиля нет (онбординг не пройден) — NotFoundError.
 */
export async function saveMealSettings(db: DB, ownerId: string, input: MealSettingsInput): Promise<MealSettings> {
  const items = input.items ?? input.plan?.map((name) => ({ name, hidden: false }));
  const set = {
    ...(items ? { mealPlan: items.map((i) => i.name), mealPlanHidden: hiddenNames(items) } : {}),
    ...(input.showTimes != null ? { showMealTimes: input.showTimes } : {}),
  };
  if (Object.keys(set).length === 0) {
    const [exists] = await db.select({ ownerId: profiles.ownerId }).from(profiles).where(eq(profiles.ownerId, ownerId));
    if (!exists) throw new NotFoundError("profile not found");
    return getMealSettings(db, ownerId);
  }
  const [p] = await db.update(profiles).set(set).where(eq(profiles.ownerId, ownerId)).returning(mealColumns);
  if (!p) throw new NotFoundError("profile not found");
  return toSettings(p);
}

export async function saveProfile(db: DB, ownerId: string, input: ProfileInput): Promise<void> {
  await db
    .insert(profiles)
    .values({ ownerId, ...input, onboardedAt: new Date() })
    .onConflictDoUpdate({ target: profiles.ownerId, set: { ...input } });
}

/** Новая строка истории, только если цель действительно изменилась. */
export async function setGoal(db: DB, ownerId: string, input: GoalInput): Promise<void> {
  const [current] = await db.select().from(goals).where(eq(goals.ownerId, ownerId)).orderBy(desc(goals.validFrom)).limit(1);
  const rate = input.kind === "maintain" ? null : input.rateKgPerWeek;
  if (current && current.kind === input.kind && current.rateKgPerWeek === rate && current.targetWeightKg === input.targetWeightKg) {
    return;
  }
  await db.insert(goals).values({ ownerId, kind: input.kind, rateKgPerWeek: rate, targetWeightKg: input.targetWeightKg });
}

export async function addWeight(
  db: DB,
  ownerId: string,
  kg: number,
  measuredAt = new Date(),
  from: { source: "manual" | "apple_health"; externalId?: string } = { source: "manual" },
): Promise<void> {
  await db
    .insert(weightLog)
    .values({ ownerId, weightKg: kg, measuredAt, source: from.source, externalId: from.externalId ?? null })
    .onConflictDoNothing(); // повторный импорт того же замера из Health — без дублей
}

export async function weightHistory(db: DB, ownerId: string, limit = 60) {
  const rows = await db
    .select({ id: weightLog.id, kg: weightLog.weightKg, measuredAt: weightLog.measuredAt })
    .from(weightLog)
    .where(eq(weightLog.ownerId, ownerId))
    .orderBy(desc(weightLog.measuredAt))
    .limit(limit);
  return rows.reverse();
}

export async function deleteWeight(db: DB, ownerId: string, id: string): Promise<void> {
  await db.delete(weightLog).where(and(eq(weightLog.id, id), eq(weightLog.ownerId, ownerId)));
}

/** value = null — вернуть расчётную норму. */
export async function setOverride(db: DB, ownerId: string, nutrient: NutrientKey, value: number | null): Promise<void> {
  if (value == null) {
    await db.delete(normsOverride).where(and(eq(normsOverride.ownerId, ownerId), eq(normsOverride.nutrient, nutrient)));
    return;
  }
  await db
    .insert(normsOverride)
    .values({ ownerId, nutrient, value })
    .onConflictDoUpdate({ target: [normsOverride.ownerId, normsOverride.nutrient], set: { value } });
}
