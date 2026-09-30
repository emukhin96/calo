"use client";

import { useState } from "react";
import { type NutrientVector, scale } from "@/domain/nutrients";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./components";
import { formatInt } from "./format";
import { GramsInput } from "./GramsInput";
import { fmtAmount } from "./nutrients";

export type IngredientFood = {
  nameRu: string;
  brand: string | null;
  per100g: NutrientVector;
  portion: { grams: number; label: string } | null;
};

const fmt1 = (x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("ru-RU", { maximumFractionDigits: x >= 10 ? 0 : 1 });

/**
 * Сколько граммов ингредиента положить в блюдо: «−  180 г  +», ползунок,
 * быстрые порции; КБЖУ пересчитываются на лету. Клавиатура сама не выскакивает.
 */
export function IngredientGramsSheet({
  food,
  initialGrams,
  submitLabel,
  onSubmit,
  onRemove,
  onClose,
}: {
  food: IngredientFood;
  initialGrams: number;
  submitLabel: string;
  onSubmit: (grams: number) => void;
  /** Для уже добавленного ингредиента — «Убрать из блюда». */
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [grams, setGrams] = useState(initialGrams);
  const n = scale(food.per100g, grams);
  const p = food.per100g;

  return (
    <BottomSheet label={food.nameRu} onClose={onClose}>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="min-w-0 text-[19px] leading-snug font-bold break-words text-ink">
            {food.nameRu}
            {food.brand && <span className="font-normal text-ink-3"> · {food.brand}</span>}
          </h2>
          <button type="button" onClick={onClose} className="shrink-0 pt-0.5 text-[16px] font-semibold text-accent">
            Отмена
          </button>
        </div>
        <p className="tabular mt-1 text-[14px] text-ink-3">
          на 100 г: {formatInt(p.kcal ?? 0)} ккал · Б {fmtAmount(p.protein)} · Ж {fmtAmount(p.fat)} · У {fmtAmount(p.carbs)}
        </p>

        <div className="mt-6">
          <GramsInput value={grams} onChange={setGrams} portion={food.portion} max={10000} />
        </div>

        <div className="mt-5 flex items-baseline justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
          <span className="tabular text-[15px] text-ink-2">
            Б {fmt1(n.protein)} · Ж {fmt1(n.fat)} · У {fmt1(n.carbs)} г
          </span>
          <span className="tabular shrink-0 text-[19px] font-bold text-ink">
            {formatInt(n.kcal ?? 0)} <span className="text-[15px] font-normal text-ink-2">ккал</span>
          </span>
        </div>

        <Button className="mt-5" disabled={!(grams > 0)} onClick={() => onSubmit(grams)}>
          {submitLabel}
        </Button>
        {onRemove && (
          <button type="button" onClick={onRemove} className="mt-2 w-full py-3 text-[16px] font-semibold text-warn">
            Убрать из блюда
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
