const NNBSP = " "; // узкий неразрывный пробел
const MINUS = "−";

/** 2458 → «2 458». Не toLocaleString: ru-RU не разделяет четырёхзначные (1830), а на макете «2 458». */
export function formatInt(n: number): string {
  const digits = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return n < 0 ? MINUS + digits : digits;
}

/** Склонение: plural(5, ["день", "дня", "дней"]) → «дней». */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
