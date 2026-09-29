// Составное блюдо: сумма ингредиентов → на 100 г готового блюда.
// Вес готового блюда отличается от суммы сырых ингредиентов: паста впитывает
// воду (100 г сухой ≈ 250 г варёной), мясо ужаривается. Без веса готового
// блюда считаем по сумме ингредиентов.
import { type NutrientVector, scale, sum } from "./nutrients";

export type Ingredient = { per100g: NutrientVector; grams: number };

export type RecipeTotals = {
  /** Сумма весов ингредиентов, г. */
  rawWeightG: number;
  /** Вес готового блюда, г (введённый или сумма ингредиентов). */
  totalWeightG: number;
  /** Всё блюдо целиком. */
  total: NutrientVector;
  /** На 100 г готового блюда — это хранится в recipes.nutrients_per_100g. */
  per100g: NutrientVector;
  /** Вес одной порции, если задано число порций. */
  portionG: number | null;
};

export function computeRecipe(
  ingredients: Ingredient[],
  opts: { totalWeightG?: number | null; portions?: number | null } = {},
): RecipeTotals {
  const rawWeightG = ingredients.reduce((s, i) => s + i.grams, 0);
  const totalWeightG = opts.totalWeightG && opts.totalWeightG > 0 ? opts.totalWeightG : rawWeightG;
  const total = sum(ingredients.map((i) => scale(i.per100g, i.grams)));
  const per100g = totalWeightG > 0 ? scale(total, (100 * 100) / totalWeightG) : {};
  const portionG = opts.portions && opts.portions > 0 && totalWeightG > 0 ? totalWeightG / opts.portions : null;
  return { rawWeightG, totalWeightG, total, per100g, portionG };
}
