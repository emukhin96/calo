// Свой продукт «КБЖУ с упаковки»: границы значений и проверка формы. Одни и те
// же правила у формы (подсказки под полями) и у POST /api/foods.
import { isLabelConsistent } from "@/domain/nutrients";

export const OWN_FOOD_LIMITS = {
  name: 120,
  brand: 80,
  kcal: 900,
  macro: 100,
  /** Б + Ж + У на 100 г: больше 100 не бывает, запас — на округление этикетки. */
  macroSum: 105,
  portion: 5000,
} as const;

export const BARCODE_RE = /^\d{8,14}$/;

export type OwnFoodInput = {
  nameRu: string;
  brand?: string | null;
  barcode?: string | null;
  per100g: { kcal: number; protein: number; fat: number; carbs: number };
  defaultPortionG?: number | null;
};

/** macros — сумма Б + Ж + У (ошибка не одного поля, а всех трёх). */
export type OwnFoodField = "nameRu" | "brand" | "barcode" | "kcal" | "protein" | "fat" | "carbs" | "macros" | "defaultPortionG";

const ok = (x: number, max: number) => Number.isFinite(x) && x >= 0 && x <= max;

/** Ошибки по полям; пустой объект — можно сохранять. NaN в числах — «не заполнено». */
export function ownFoodErrors(f: OwnFoodInput): Partial<Record<OwnFoodField, string>> {
  const e: Partial<Record<OwnFoodField, string>> = {};
  const L = OWN_FOOD_LIMITS;
  const name = f.nameRu.trim();
  if (!name) e.nameRu = "Нужно название";
  else if (name.length > L.name) e.nameRu = `Не длиннее ${L.name} символов`;
  if ((f.brand?.trim().length ?? 0) > L.brand) e.brand = `Не длиннее ${L.brand} символов`;
  if (f.barcode && !BARCODE_RE.test(f.barcode)) e.barcode = "От 8 до 14 цифр";

  const { kcal, protein, fat, carbs } = f.per100g;
  if (!ok(kcal, L.kcal)) e.kcal = Number.isFinite(kcal) ? `От 0 до ${L.kcal}` : "Нужно число";
  for (const [key, v] of [["protein", protein], ["fat", fat], ["carbs", carbs]] as const) {
    if (!ok(v, L.macro)) e[key] = Number.isFinite(v) ? `От 0 до ${L.macro} г` : "Нужно число";
  }
  if (!e.protein && !e.fat && !e.carbs && protein + fat + carbs > L.macroSum) {
    e.macros = "Белков, жиров и углеводов вместе больше 100 г на 100 г — проверьте цифры";
  }

  const p = f.defaultPortionG;
  if (p != null && !(Number.isFinite(p) && p >= 1 && p <= L.portion)) e.defaultPortionG = `От 1 до ${L.portion} г`;
  return e;
}

/**
 * Калории по БЖУ (4·Б + 9·Ж + 4·У), если они заметно расходятся с введёнными, —
 * мягкая подсказка об опечатке; null — сходится или считать не из чего.
 */
export function kcalMismatch(per100g: OwnFoodInput["per100g"]): number | null {
  const { kcal, protein, fat, carbs } = per100g;
  if (![kcal, protein, fat, carbs].every(Number.isFinite)) return null;
  if (isLabelConsistent({ kcal, protein, fat, carbs })) return null;
  return Math.round(4 * protein + 9 * fat + 4 * carbs);
}
