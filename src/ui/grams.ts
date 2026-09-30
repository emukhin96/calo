// Чистая логика поля граммов (GramsInput): шаг кнопками, ввод текстом, шкала
// ползунка, ускорение при удержании. Тесты — src/ui/grams.test.ts.

const round1 = (x: number) => Math.round(x * 10) / 10;
/** Запас на двоичную арифметику: 170,00000001 / 10 — это ещё 17 шагов. */
const EPS = 1e-9;

/**
 * Шаг кнопкой ±: к ближайшему кратному шагу в нужную сторону (183 → 190 / 180,
 * 180 → 190 / 170). Ниже одного шага кнопка «−» не опускает: 0 г в еде не бывает,
 * а 5 г соли можно ввести числом или ползунком.
 */
export function stepGrams(value: number, dir: 1 | -1, step: number, max: number): number {
  if (dir > 0) {
    const next = round1((Math.floor(value / step + EPS) + 1) * step);
    return value >= max ? value : Math.min(next, max);
  }
  if (value <= step) return value;
  const next = round1((Math.ceil(value / step - EPS) - 1) * step);
  return Math.max(next, step);
}

/** Граммы из текста: «180», «2,5», «12.» → число; пусто, ноль и мусор → null. Больше max — max. */
export function parseGrams(text: string, max: number): number | null {
  const n = round1(Number(text.trim().replace(",", ".")));
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, max);
}

/** Пока печатают: цифры и одна запятая, не больше одного знака после неё. «1,» не теряется. */
export function sanitizeGrams(raw: string): string {
  const s = raw.replace(/\./g, ",").replace(/[^\d,]/g, "");
  const [int, ...rest] = s.split(",");
  return rest.length ? `${int.slice(0, 5)},${rest.join("").slice(0, 1)}` : int.slice(0, 5);
}

/** 180 → «180», 2.5 → «2,5» — без разрядных пробелов: это текст поля ввода. */
export const formatGrams = (g: number) => String(round1(g)).replace(".", ",");

const roundUp = (x: number, to: number) => Math.ceil(x / to) * to;

/**
 * Правый край ползунка: не меньше 500 г, вдвое больше текущего веса и втрое
 * больше порции. Только растёт — и только когда вес вышел за край: пока тянут
 * ползунок, шкала не «прыгает».
 */
export function sliderMax(value: number, portionG: number | null | undefined, prev: number | null, max: number): number {
  if (prev != null && (value <= prev || prev >= max)) return prev;
  const want = Math.max(500, roundUp(2 * value, 100), portionG ? roundUp(3 * portionG, 100) : 0);
  return Math.min(max, Math.max(prev ?? 0, want));
}

/**
 * Пауза перед n-м повтором при удержании кнопки: сначала 400 мс (чтобы короткое
 * нажатие осталось одним шагом), дальше всё чаще — до 45 мс.
 */
export function holdDelay(n: number): number {
  if (n <= 0) return 400;
  return Math.max(45, Math.round(160 * 0.85 ** (n - 1)));
}
