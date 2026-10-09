// Допустимые значения онбординга — те же, что проверяет сервер (lib/profile-schema).

export const HEIGHT_CM = [120, 230] as const;
export const WEIGHT_KG = [30, 300] as const;
/** Нормы рассчитаны на взрослых: от 18 до 100 лет. */
export const AGE_YEARS = [18, 100] as const;

/**
 * Значение вне [min, max], и дописыванием цифр его уже не исправить. Пока человек
 * печатает «17» на пути к «175», подсказку не показываем — только для «17,5» или «500».
 */
export function outOfRange(v: number | null, min: number, max: number): boolean {
  return v != null && (v > max || (v < min && (v * 10 > max || !Number.isInteger(v))));
}
