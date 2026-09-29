"use client";

import { useEffect, useState } from "react";
import { MEAL_RU, MEALS, type Meal } from "@/domain/day";
import { type NutrientVector, scale } from "@/domain/nutrients";
import { Button } from "./components";
import { formatInt } from "./format";

type Props = {
  title: string;
  subtitle?: string;
  per100g: NutrientVector;
  initialGrams: number;
  initialMeal: Meal;
  /** Порция из справочника: «1 шт (55 г)», «30 g». */
  portion?: { grams: number; label: string } | null;
  submitLabel: string;
  onSubmit: (grams: number, meal: Meal) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

const QUICK = [50, 100, 150, 200, 250];
const fmt1 = (x: number | null | undefined) =>
  x == null ? "—" : x.toLocaleString("ru-RU", { maximumFractionDigits: x >= 10 ? 0 : 1 });

/** Лист снизу: сколько граммов и в какой приём пищи. Нутриенты пересчитываются на лету. */
export function PortionSheet(p: Props) {
  const [text, setText] = useState(String(p.initialGrams));
  const [meal, setMeal] = useState<Meal>(p.initialMeal);
  const [busy, setBusy] = useState(false);
  const grams = Number(text.replace(",", "."));
  const valid = Number.isFinite(grams) && grams > 0 && grams <= 5000;
  const n = scale(p.per100g, valid ? grams : 0);

  // Esc закрывает; прокрутка страницы под листом заблокирована.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [p]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30" onClick={p.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-t-[var(--radius-sheet)] bg-bg px-6 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-line" />
        <h2 className="text-[19px] leading-snug font-bold text-ink">{p.title}</h2>
        {p.subtitle && <p className="mt-1 text-[14px] text-ink-3">{p.subtitle}</p>}

        <div className="mt-5 flex items-baseline gap-3">
          <input
            aria-label="Граммы"
            inputMode="decimal"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, ""))}
            onFocus={(e) => e.currentTarget.select()}
            className="tabular w-32 rounded-2xl border border-line bg-surface px-4 py-2 font-display text-[34px] font-extrabold text-ink outline-none focus:border-accent"
          />
          <span className="text-[17px] text-ink-2">г</span>
          <span className="tabular ml-auto text-right text-[17px] font-bold text-ink">
            {valid ? formatInt(n.kcal ?? 0) : "—"} <span className="font-normal text-ink-2">ккал</span>
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {p.portion && (
            <Chip active={grams === p.portion.grams} onClick={() => setText(String(p.portion!.grams))}>
              {p.portion.label}
            </Chip>
          )}
          {QUICK.map((g) => (
            <Chip key={g} active={grams === g} onClick={() => setText(String(g))}>
              {g} г
            </Chip>
          ))}
        </div>

        <p className="tabular mt-4 text-[15px] text-ink-2">
          Белки {fmt1(n.protein)} г · Жиры {fmt1(n.fat)} г · Углеводы {fmt1(n.carbs)} г
        </p>

        <div className="mt-5 grid grid-cols-4 gap-1 rounded-2xl bg-line/60 p-1">
          {MEALS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMeal(m)}
              className={`rounded-xl py-2 text-[14px] font-semibold ${meal === m ? "bg-surface text-ink shadow-sm" : "text-ink-2"}`}
            >
              {MEAL_RU[m]}
            </button>
          ))}
        </div>

        <Button className="mt-6" disabled={!valid || busy} onClick={() => run(() => p.onSubmit(grams, meal))}>
          {busy ? "Сохраняю…" : p.submitLabel}
        </Button>
        {p.onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(p.onDelete!)}
            className="mt-3 w-full py-3 text-[16px] font-semibold text-warn disabled:opacity-50"
          >
            Удалить запись
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-[14px] font-semibold ${
        active ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2"
      }`}
    >
      {children}
    </button>
  );
}
