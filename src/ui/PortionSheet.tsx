"use client";

import { useState } from "react";
import { type NutrientVector, scale } from "@/domain/nutrients";
import { isMealChoiceValid, newMealChoice } from "@/lib/meal-choice";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./components";
import { formatInt } from "./format";
import { GramsInput } from "./GramsInput";
import { type DayMeal, type MealChoice, MealPicker } from "./MealPicker";

type Props = {
  title: string;
  subtitle?: string;
  per100g: NutrientVector;
  /** Как есть, без округления: дробная порция (12,5 г) совпадает с её быстрой кнопкой. */
  initialGrams: number;
  /** Порция из справочника: «1 шт (55 г)», «30 g» — первая быстрая кнопка. */
  portion?: { grams: number; label: string } | null;
  /** Приёмы дня, в который пишем, — по порядку (lib/meal-choice toDayMeals). */
  meals: DayMeal[];
  /** Приёмы из своего списка в Профиле, которые предлагаются (без скрытых), — кнопки выбора. */
  plan: string[];
  /** Весь свой список, со скрытыми: куда встанет новый приём (подсказка); без него — plan. */
  order?: string[];
  /** Показ времени приёмов включён в Профиле: у нового приёма есть поле времени. */
  showTimes: boolean;
  initialMeal: MealChoice;
  /** Время нового приёма в поле, пока его не меняли, — сегодня «сейчас»; без него — типичное для названия. */
  defaultNewTime?: string;
  submitLabel: string;
  onSubmit: (grams: number, meal: MealChoice) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** Дополнительное действие под кнопкой: «Сохранить как блюдо». */
  extra?: { label: string; run: () => Promise<void> };
  onClose: () => void;
};

const MAX_GRAMS = 5000;
/** Быстрые кнопки — в одну строку на 375 px, с порцией из справочника первой. */
const QUICK = [50, 100, 150, 200];
const QUICK_WITH_PORTION = [100, 200];
const fmt1 = (x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("ru-RU", { maximumFractionDigits: x >= 10 ? 0 : 1 });

/**
 * Лист снизу: сколько граммов («−  180 г  +», ползунок, быстрые кнопки — без
 * клавиатуры) и в какой приём пищи. КБЖУ пересчитываются на лету.
 */
export function PortionSheet(p: Props) {
  const [grams, setGrams] = useState(p.initialGrams);
  const [meal, setMeal] = useState<MealChoice>(p.initialMeal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const valid = grams > 0 && grams <= MAX_GRAMS && isMealChoiceValid(meal);
  const n = scale(p.per100g, grams);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet label={p.title} onClose={p.onClose}>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-6">
        {/* Без «Отмены» в шапке: лист закрывается тапом по затемнению, а название
            с брендом умещается в строку — главная кнопка видна без прокрутки. */}
        <h2 className="text-[19px] leading-snug font-bold break-words text-ink">
          {p.title}
          {p.subtitle && <span className="font-normal text-ink-3"> · {p.subtitle}</span>}
        </h2>

        <div className="mt-5">
          <GramsInput value={grams} onChange={setGrams} portion={p.portion} max={MAX_GRAMS} quick={p.portion ? QUICK_WITH_PORTION : QUICK} />
        </div>

        <div className="mt-4 flex items-baseline justify-between gap-3 rounded-2xl bg-surface px-4 py-2.5">
          <span className="tabular min-w-0 text-[15px] text-ink-2">
            Б {fmt1(n.protein)} · Ж {fmt1(n.fat)} · У {fmt1(n.carbs)} г
          </span>
          <span className="tabular shrink-0 text-[19px] font-bold text-ink">
            {formatInt(n.kcal ?? 0)} <span className="text-[15px] font-normal text-ink-2">ккал</span>
          </span>
        </div>

        <div className="mt-5">
          <MealPicker
            meals={p.meals}
            plan={p.plan}
            order={p.order}
            showTimes={p.showTimes}
            value={meal}
            onChange={setMeal}
            defaultNewTime={p.defaultNewTime}
          />
        </div>

        {error && <p className="mt-4 text-[15px] text-warn">Не получилось — проверьте сеть и попробуйте ещё раз</p>}
        <Button
          className="mt-5"
          disabled={!valid || busy}
          // Новый приём: есть ли такой в дне — по приёмам сейчас (день могли обновить, пока лист открыт).
          onClick={() => run(() => p.onSubmit(grams, meal.kind === "new" ? newMealChoice(p.meals, meal.name, meal.time) : meal))}
        >
          {busy ? "Сохраняю…" : p.submitLabel}
        </Button>
        {p.onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(p.onDelete!)}
            className="mt-2 w-full py-3 text-[16px] font-semibold text-warn disabled:opacity-50"
          >
            Удалить запись
          </button>
        )}
        {p.extra && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(p.extra!.run)}
            className={`${p.onDelete ? "" : "mt-2 "}w-full py-2 text-[15px] font-semibold text-accent disabled:opacity-50`}
          >
            {p.extra.label}
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
