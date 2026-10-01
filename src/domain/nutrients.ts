// Вектор нутриентов и операции над ним — docs/ARCHITECTURE.md §3.
// Отсутствующее значение — null («нет данных»), а не 0.

export const MACROS = ["kcal", "protein", "fat", "carbs", "fiber", "sugar"] as const;
export const MICROS = [
  "vitA", "vitC", "vitD", "vitE", "vitK",
  "b1", "b2", "b6", "b9", "b12",
  "calcium", "iron", "magnesium", "potassium", "sodium", "zinc", "selenium",
  "omega3",
] as const;
export const NUTRIENT_KEYS = [...MACROS, ...MICROS] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type NutrientVector = Partial<Record<NutrientKey, number | null>>;

/** Единицы хранения (на 100 г продукта). Совпадают с USDA — пересчёта при импорте нет. */
export const NUTRIENT_UNITS: Record<NutrientKey, "kcal" | "g" | "mg" | "µg"> = {
  kcal: "kcal", protein: "g", fat: "g", carbs: "g", fiber: "g", sugar: "g",
  vitA: "µg", // RAE
  vitC: "mg", vitD: "µg", vitE: "mg", vitK: "µg",
  b1: "mg", b2: "mg", b6: "mg",
  b9: "µg", // DFE
  b12: "µg",
  calcium: "mg", iron: "mg", magnesium: "mg", potassium: "mg", sodium: "mg", zinc: "mg",
  selenium: "µg",
  omega3: "g", // ALA + EPA + DPA + DHA
};

/** Нутриенты порции из значений на 100 г. */
export function scale(per100g: NutrientVector, grams: number): NutrientVector {
  const k = grams / 100;
  const out: NutrientVector = {};
  for (const key of NUTRIENT_KEYS) {
    const v = per100g[key];
    if (v != null) out[key] = v * k;
    else if (key in per100g) out[key] = null;
  }
  return out;
}

/**
 * Значения на 100 г из нутриентов порции — обратное к scale: снимок записи
 * дневника пересчитывается на новые граммы (сервер при правке, лист правки на
 * экране дня). «Нет данных» остаётся null; при grams <= 0 пересчитать не из чего —
 * известные значения тоже null.
 */
export function per100gOf(portion: NutrientVector, grams: number): NutrientVector {
  const out: NutrientVector = {};
  for (const key of NUTRIENT_KEYS) {
    const v = portion[key];
    if (v != null && grams > 0) out[key] = (v * 100) / grams;
    else if (key in portion) out[key] = null;
  }
  return out;
}

/**
 * Сумма векторов. Если хотя бы у одного слагаемого значение неизвестно,
 * сумма по этому ключу тоже неизвестна — иначе недобор витаминов оказался бы
 * мнимым. coverage показывает, у скольких слагаемых значение было.
 */
export function sum(vectors: NutrientVector[]): NutrientVector {
  const out: NutrientVector = {};
  for (const key of NUTRIENT_KEYS) {
    let total = 0;
    let known = 0;
    for (const v of vectors) {
      const x = v[key];
      if (x != null) {
        total += x;
        known++;
      }
    }
    if (known === vectors.length && known > 0) out[key] = total;
    else if (known > 0) out[key] = null;
  }
  return out;
}

/** Доля слагаемых, у которых известен нутриент (0…1). */
export function coverage(vectors: NutrientVector[], key: NutrientKey): number {
  if (vectors.length === 0) return 0;
  return vectors.filter((v) => v[key] != null).length / vectors.length;
}

/**
 * Сходится ли этикетка: 4·Б + 9·Ж + 4·У (+ 2·клетчатка + 7·спирт) ≈ ккал.
 * Отсекает опечатки в Open Food Facts вроде «белок 0,1 г» у макарон. Допуск ±20%
 * (не меньше 20 ккал): полиолы и округления на этикетке дают расхождение.
 * Углеводы на этикетках Канады и США — вместе с клетчаткой (у нас и в ЕС — без
 * неё), поэтому сходится и любой из двух счётов: у чечевицы «углеводы 29, из них
 * клетчатка 15» — не опечатка. alcohol — граммы спирта на 100 г (коньяк, пиво):
 * без него у напитка 0 г БЖУ при 230 ккал.
 */
export function isLabelConsistent(n: NutrientVector, alcohol = 0): boolean {
  const { kcal, protein, fat, carbs, fiber } = n;
  if (kcal == null || protein == null || fat == null || carbs == null) return false;
  const base = 4 * protein + 9 * fat + 7 * alcohol;
  const fib = fiber ?? 0;
  const tolerance = Math.max(20, 0.2 * kcal);
  const near = (estimate: number) => Math.abs(estimate - kcal) <= tolerance;
  return near(base + 4 * carbs + 2 * fib) || (fib > 0 && fib <= carbs && near(base + 4 * (carbs - fib) + 2 * fib));
}
