import { NUTRIENT_UNITS, type NutrientKey } from "@/domain/nutrients";

export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
  kcal: "Энергия", protein: "Белки", fat: "Жиры", carbs: "Углеводы", fiber: "Клетчатка", sugar: "Сахара",
  vitA: "Витамин A", vitC: "Витамин C", vitD: "Витамин D", vitE: "Витамин E", vitK: "Витамин K",
  b1: "B1 (тиамин)", b2: "B2 (рибофлавин)", b6: "B6", b9: "B9 (фолаты)", b12: "B12",
  calcium: "Кальций", iron: "Железо", magnesium: "Магний", potassium: "Калий", sodium: "Натрий",
  zinc: "Цинк", selenium: "Селен", omega3: "Омега-3",
};

const UNIT_RU = { kcal: "ккал", g: "г", mg: "мг", "µg": "мкг" } as const;
export const unitRu = (k: NutrientKey) => UNIT_RU[NUTRIENT_UNITS[k]];

/** 0,35 · 12,4 · 1 250 — по величине. */
export function fmtAmount(x: number | null | undefined): string {
  if (x == null) return "—";
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return x.toLocaleString("ru-RU", { maximumFractionDigits: digits }).replace(/\s/g, " ");
}
