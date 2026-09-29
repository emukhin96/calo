// Профиль, цель, вес и ручные нормы. Цель и вес — история (новая строка на
// каждое изменение), текущие значения — последние строки. ARCHITECTURE.md §4.
import { and, desc, eq } from "drizzle-orm";
import type { NutrientKey } from "@/domain/nutrients";
import type { Activity, GoalKind, Sex } from "@/domain/norms";
import type { DB } from ".";
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
};

export async function getUserState(db: DB, ownerId: string): Promise<UserState> {
  const [[p], [g], [w], overrides] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.ownerId, ownerId)),
    db.select().from(goals).where(eq(goals.ownerId, ownerId)).orderBy(desc(goals.validFrom)).limit(1),
    db.select().from(weightLog).where(eq(weightLog.ownerId, ownerId)).orderBy(desc(weightLog.measuredAt)).limit(1),
    db.select().from(normsOverride).where(eq(normsOverride.ownerId, ownerId)),
  ]);
  return {
    profile: p
      ? { sex: p.sex, birthYear: p.birthYear, heightCm: p.heightCm, activity: p.activity, timezone: p.timezone, onboardedAt: p.onboardedAt }
      : null,
    goal: g ? { kind: g.kind, rateKgPerWeek: g.rateKgPerWeek, targetWeightKg: g.targetWeightKg } : null,
    weight: w ? { kg: w.weightKg, measuredAt: w.measuredAt } : null,
    overrides: Object.fromEntries(overrides.map((o) => [o.nutrient, o.value])),
  };
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
