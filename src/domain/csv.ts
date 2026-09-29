// Выгрузка дневника в CSV для Excel/Numbers: разделитель «;» и десятичная
// запятая — так русская локаль открывает файл двойным щелчком без мастера импорта.
import { MEAL_RU, type Meal, zonedParts } from "./day";
import { NUTRIENT_KEYS, NUTRIENT_UNITS, type NutrientVector } from "./nutrients";

export type CsvEntry = { eatenAt: Date; meal: Meal; title: string; grams: number; nutrients: NutrientVector };

const HEAD_RU: Record<(typeof NUTRIENT_KEYS)[number], string> = {
  kcal: "Ккал", protein: "Белки", fat: "Жиры", carbs: "Углеводы", fiber: "Клетчатка", sugar: "Сахара",
  vitA: "Витамин A", vitC: "Витамин C", vitD: "Витамин D", vitE: "Витамин E", vitK: "Витамин K",
  b1: "B1", b2: "B2", b6: "B6", b9: "B9", b12: "B12",
  calcium: "Кальций", iron: "Железо", magnesium: "Магний", potassium: "Калий", sodium: "Натрий",
  zinc: "Цинк", selenium: "Селен", omega3: "Омега-3",
};
const UNIT_RU = { kcal: "", g: "г", mg: "мг", "µg": "мкг" } as const;

const cell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const num = (x: number | null | undefined) =>
  x == null ? "" : String(Math.round(x * 100) / 100).replace(".", ",");

export function entriesToCsv(entries: CsvEntry[], tz: string): string {
  const header = [
    "Дата", "Время", "Приём пищи", "Продукт", "Граммы",
    ...NUTRIENT_KEYS.map((k) => (UNIT_RU[NUTRIENT_UNITS[k]] ? `${HEAD_RU[k]}, ${UNIT_RU[NUTRIENT_UNITS[k]]}` : HEAD_RU[k])),
  ];
  const rows = entries.map((e) => {
    const p = zonedParts(e.eatenAt, tz);
    const time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    return [p.date, time, MEAL_RU[e.meal], e.title, num(e.grams), ...NUTRIENT_KEYS.map((k) => num(e.nutrients[k]))];
  });
  // BOM — чтобы Excel распознал UTF-8 и кириллицу.
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
