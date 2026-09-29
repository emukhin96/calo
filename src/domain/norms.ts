// Дневные нормы из профиля и цели — docs/ARCHITECTURE.md §4а.
// Витамины и минералы: МР 2.3.1.0253-21, табл. 11, 12 (мужчины), 16, 17 (женщины);
// выдержка — docs/norms-source.md. Чистые функции: пересчёт при любой смене веса или цели.
import type { NutrientKey } from "./nutrients";

export type Sex = "female" | "male";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalKind = "lose" | "maintain" | "gain";

export type NormInput = {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: Activity;
  goal: GoalKind;
  /** кг в неделю для lose/gain: 0.25 | 0.5 | 0.75 */
  rateKgPerWeek?: number | null;
};

/**
 * min — добрать не меньше (белок, витамины); target — ориентир (жиры, углеводы);
 * limit — не больше (натрий).
 */
export type NormKind = "min" | "target" | "limit";
export type Norm = { value: number; kind: NormKind };

export type Norms = {
  kcal: number;
  /** Коридор нормы по калориям: ±10 %. */
  kcalRange: [number, number];
  nutrients: Partial<Record<NutrientKey, Norm>>;
  meta: {
    bmr: number;
    tdee: number;
    /** Темп снижения упёрся в безопасный минимум калорий. */
    floorApplied: boolean;
    proteinPerKg: number;
  };
};

export const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_RU: Record<Activity, { title: string; hint: string }> = {
  sedentary: { title: "Сидячий образ жизни", hint: "офис, машина, спорта почти нет" },
  light: { title: "Лёгкая активность", hint: "прогулки, тренировки 1–3 раза в неделю" },
  moderate: { title: "Средняя активность", hint: "тренировки 3–5 раз в неделю" },
  active: { title: "Высокая активность", hint: "тренировки 6–7 раз в неделю или работа на ногах" },
  very_active: { title: "Очень высокая", hint: "физический труд или спорт дважды в день" },
};

export const GOAL_RU: Record<GoalKind, string> = {
  lose: "Снизить вес",
  maintain: "Удержать вес",
  gain: "Набрать вес",
};

const KCAL_PER_KG = 7700;
const PROTEIN_PER_KG: Record<GoalKind, number> = { lose: 1.8, maintain: 1.4, gain: 1.8 };

/** Основной обмен по Миффлину — Сан Жеору, ккал/сутки. */
export function bmrMifflin({ sex, age, heightCm, weightKg }: Pick<NormInput, "sex" | "age" | "heightCm" | "weightKg">): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

/**
 * Вес для расчёта белка: при ИМТ > 30 — вес при ИМТ 27, иначе норма белка
 * на кг фактического веса получается неоправданно большой.
 */
export function proteinReferenceWeight(heightCm: number, weightKg: number): number {
  const h = heightCm / 100;
  return weightKg / (h * h) > 30 ? 27 * h * h : weightKg;
}

/** Микронутриенты по МР 2.3.1.0253-21 (взрослые старше 18 лет). */
function microNorms(sex: Sex, age: number): Partial<Record<NutrientKey, Norm>> {
  const f = sex === "female";
  const min = (value: number): Norm => ({ value, kind: "min" });
  return {
    vitC: min(100),
    b1: min(1.5),
    b2: min(1.8),
    b6: min(2.0),
    b9: min(400),
    b12: min(3.0),
    vitA: min(f ? 800 : 900),
    vitE: min(15),
    vitD: min(age >= 65 ? 20 : 15),
    vitK: min(120),
    calcium: min(age >= 65 ? 1200 : 1000),
    magnesium: min(420),
    potassium: min(3500),
    iron: min(f ? 18 : 10),
    zinc: min(12),
    selenium: min(f ? 55 : 70),
    // МР даёт физиологическую потребность 1300 мг; для предупреждений важен
    // верхний предел — ВОЗ: не больше 2 г натрия (5 г соли) в сутки.
    sodium: { value: 2000, kind: "limit" },
  };
}

const round = (x: number, step = 1) => Math.round(x / step) * step;

export function computeNorms(input: NormInput): Norms {
  const bmr = bmrMifflin(input);
  const tdee = bmr * ACTIVITY_FACTOR[input.activity];
  const rate = input.goal === "maintain" ? 0 : (input.rateKgPerWeek ?? 0.5);
  const delta = (rate * KCAL_PER_KG) / 7;

  let kcal = tdee;
  let floorApplied = false;
  if (input.goal === "lose") {
    const floor = Math.max(bmr * 1.1, input.sex === "female" ? 1200 : 1500);
    kcal = tdee - delta;
    if (kcal < floor) {
      kcal = floor;
      floorApplied = true;
    }
  } else if (input.goal === "gain") {
    kcal = Math.min(tdee + delta, tdee * 1.15);
  }
  kcal = round(kcal, 10);

  const proteinPerKg = PROTEIN_PER_KG[input.goal];
  const protein = round(proteinPerKg * proteinReferenceWeight(input.heightCm, input.weightKg));
  // Жиры: 30 % калорий (МР, табл. 10/15), но не меньше 0,8 г/кг.
  const fat = round(Math.max((0.3 * kcal) / 9, 0.8 * input.weightKg));
  const carbs = Math.max(0, round((kcal - 4 * protein - 9 * fat) / 4));

  return {
    kcal,
    kcalRange: [round(kcal * 0.9, 10), round(kcal * 1.1, 10)],
    nutrients: {
      kcal: { value: kcal, kind: "target" },
      protein: { value: protein, kind: "min" },
      fat: { value: fat, kind: "target" },
      carbs: { value: carbs, kind: "target" },
      fiber: { value: 20, kind: "min" }, // МР: 20–25 г
      // Омега-3: 1–2 % калорий (МР) — нижняя граница, 9 ккал/г.
      omega3: { value: round((0.01 * kcal) / 9, 0.1), kind: "min" },
      ...microNorms(input.sex, input.age),
    },
    meta: { bmr: round(bmr), tdee: round(tdee), floorApplied, proteinPerKg },
  };
}

/** Ручная правка норм поверх расчёта (таблица norms_override). */
export function applyOverrides(norms: Norms, overrides: Partial<Record<NutrientKey, number>>): Norms {
  const nutrients = { ...norms.nutrients };
  for (const [key, value] of Object.entries(overrides) as [NutrientKey, number][]) {
    if (!(value > 0)) continue;
    nutrients[key] = { value, kind: nutrients[key]?.kind ?? "min" };
  }
  const kcal = nutrients.kcal?.value ?? norms.kcal;
  return { ...norms, kcal, kcalRange: [round(kcal * 0.9, 10), round(kcal * 1.1, 10)], nutrients };
}

export const ageFromBirthYear = (birthYear: number, now = new Date()) => now.getUTCFullYear() - birthYear;
