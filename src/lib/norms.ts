import "server-only";
import { db } from "@/db";
import { getUserState, type UserState } from "@/db/profile";
import { ageFromBirthYear, applyOverrides, computeNorms, type Norms } from "@/domain/norms";

/** Нормы пользователя из текущих профиля, цели, веса и ручных правок. null — онбординг не пройден. */
export function normsFromState(state: UserState, now = new Date()): Norms | null {
  const { profile, goal, weight } = state;
  if (!profile || !goal || !weight) return null;
  const norms = computeNorms({
    sex: profile.sex,
    age: ageFromBirthYear(profile.birthYear, now),
    heightCm: profile.heightCm,
    weightKg: weight.kg,
    activity: profile.activity,
    goal: goal.kind,
    rateKgPerWeek: goal.rateKgPerWeek,
  });
  return applyOverrides(norms, state.overrides);
}

/**
 * Состояние пользователя для страниц и /api/me: профиль, цель, вес, нормы и
 * настройки приёмов пищи (свой порядок приёмов, показ времени).
 */
export async function loadUser(ownerId: string) {
  const state = await getUserState(db, ownerId);
  return { state, norms: normsFromState(state), mealPlan: state.mealPlan, showMealTimes: state.showMealTimes };
}
