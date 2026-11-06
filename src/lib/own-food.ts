// Свой продукт «КБЖУ с упаковки»: границы значений и проверка формы. Одни и те
// же правила у формы (подсказки под полями) и у POST /api/foods.
import { BARCODE_RE, gtinCheckOk, isInStoreCode } from "@/domain/barcode";
import { isLabelConsistent } from "@/domain/nutrients";

export { BARCODE_RE };

export const OWN_FOOD_LIMITS = {
  name: 120,
  brand: 80,
  kcal: 900,
  macro: 100,
  /** Б + Ж + У на 100 г: больше 100 не бывает, запас — на округление этикетки. */
  macroSum: 105,
  portion: 5000,
} as const;

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
  // Сканер такой код не прочтёт: опечатка — и товар потом не найдётся по штрихкоду.
  else if (f.barcode && !gtinCheckOk(f.barcode)) e.barcode = "Не сходится последняя (контрольная) цифра — проверьте код";

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

/**
 * Пояснение над формой своего продукта, когда штрихкода нет в базах. Внутренний
 * код магазина (весовой сыр, выпечка) — отдельный случай: у следующей упаковки
 * код будет другим, сканер его потом не найдёт.
 */
export function barcodeNotFoundNote(code: string): string {
  return isInStoreCode(code)
    ? `${code} — внутренний код магазина (весовой товар): в базах товаров его нет, а у другой упаковки он будет другим. Перепишите КБЖУ с этикетки или найдите продукт поиском.`
    : `Товара ${code} нет в Open Food Facts или у него нет КБЖУ. Перепишите их с упаковки — в следующий раз товар найдётся сканером.`;
}

export type LabelBasis = "100g" | "serving";

/**
 * Значения с этикетки «на порцию» → на 100 г. В Канаде и США таблица всегда на
 * порцию («Per 1 cup (250 mL)», «pour 2 biscuits (22 g)»); миллилитры считаем
 * граммами. Округление — до 0,1, как пишут на этикетках. NaN остаётся NaN
 * («не заполнено»), порция не больше нуля — тоже NaN.
 */
export function per100FromServing(perServing: OwnFoodInput["per100g"], servingG: number): OwnFoodInput["per100g"] {
  const k = Number.isFinite(servingG) && servingG > 0 ? 100 / servingG : NaN;
  const conv = (x: number) => Math.round(x * k * 10) / 10;
  return { kcal: conv(perServing.kcal), protein: conv(perServing.protein), fat: conv(perServing.fat), carbs: conv(perServing.carbs) };
}

/** Порция с этикетки: от 1 г до OWN_FOOD_LIMITS.portion. */
export function servingError(servingG: number): string | undefined {
  if (!Number.isFinite(servingG)) return "Нужен вес порции с этикетки";
  return servingG >= 1 && servingG <= OWN_FOOD_LIMITS.portion ? undefined : `От 1 до ${OWN_FOOD_LIMITS.portion} г`;
}
