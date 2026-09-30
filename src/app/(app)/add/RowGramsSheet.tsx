"use client";

import { useState } from "react";
import { type NutrientVector, scale } from "@/domain/nutrients";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/components";
import { formatInt } from "@/ui/format";
import { GramsInput } from "@/ui/GramsInput";

/** Столько же принимает POST /api/entries. */
const MAX_GRAMS = 5000;
/** Быстрые кнопки — как в листе порции: в одну строку на 375 px, порция первой. */
const QUICK = [50, 100, 150, 200];
const QUICK_WITH_PORTION = [100, 200];
const fmt1 = (x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("ru-RU", { maximumFractionDigits: x >= 10 ? 0 : 1 });

/**
 * Граммы позиции разбора текста: «−  180 г  +», ползунок, быстрые кнопки —
 * клавиатура сама не выскакивает. Продукт ещё не выбран — без КБЖУ.
 */
export function RowGramsSheet({
  title,
  subtitle,
  per100g,
  portion,
  initialGrams,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  per100g: NutrientVector | null;
  /** «2 шт (110 г)», «порция 30 г» — первая быстрая кнопка. */
  portion: { grams: number; label: string } | null;
  initialGrams: number;
  onSubmit: (grams: number) => void;
  onClose: () => void;
}) {
  const [grams, setGrams] = useState(initialGrams);
  const valid = grams > 0 && grams <= MAX_GRAMS;
  const n = per100g ? scale(per100g, grams) : null;

  return (
    <BottomSheet label={`Граммы: ${title}`} onClose={onClose}>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-6">
        <h2 className="text-[19px] leading-snug font-bold break-words text-ink">
          {title}
          {subtitle && <span className="font-normal text-ink-3"> · {subtitle}</span>}
        </h2>

        <div className="mt-5">
          <GramsInput value={grams} onChange={setGrams} portion={portion} max={MAX_GRAMS} quick={portion ? QUICK_WITH_PORTION : QUICK} />
        </div>

        {n && (
          <div className="mt-4 flex items-baseline justify-between gap-3 rounded-2xl bg-surface px-4 py-2.5">
            <span className="tabular min-w-0 text-[15px] text-ink-2">
              Б {fmt1(n.protein)} · Ж {fmt1(n.fat)} · У {fmt1(n.carbs)} г
            </span>
            <span className="tabular shrink-0 text-[19px] font-bold text-ink">
              {formatInt(n.kcal ?? 0)} <span className="text-[15px] font-normal text-ink-2">ккал</span>
            </span>
          </div>
        )}

        <Button className="mt-5" disabled={!valid} onClick={() => onSubmit(grams)}>
          Готово
        </Button>
      </div>
    </BottomSheet>
  );
}
