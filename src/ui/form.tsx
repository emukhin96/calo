"use client";

import type { ReactNode } from "react";

/** Крупная карточка выбора: «Снизить вес», «Сидячий образ жизни — офис, машина…». */
export function OptionCard({
  selected,
  onClick,
  title,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`w-full rounded-2xl border-2 px-5 py-4 text-left transition ${
        selected ? "border-accent bg-surface" : "border-transparent bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-[17px] font-bold text-ink">{title}</span>
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
            selected ? "border-accent bg-accent" : "border-line"
          }`}
        >
          {selected && <span className="size-2 rounded-full bg-white" />}
        </span>
      </div>
      {hint && <p className="mt-1 text-[14px] leading-snug text-ink-3">{hint}</p>}
    </button>
  );
}

/** Сегменты: пол, темп. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    // minmax(0, 1fr): длинная подпись переносится внутри сегмента, а не раздвигает сетку шире экрана
    <div className="grid gap-1 rounded-2xl bg-line/60 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-xl px-2 py-2.5 text-[15px] font-semibold ${
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-2"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Числовое поле с единицей: «Рост 180 см». Пустая строка — не заполнено. */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[15px] font-semibold text-ink">{label}</span>
      <div className="mt-1.5 flex items-baseline gap-2 rounded-2xl border border-line bg-surface px-4 py-2 focus-within:border-accent">
        <input
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
          className="tabular w-full min-w-0 bg-transparent font-display text-[26px] font-extrabold text-ink outline-none placeholder:font-sans placeholder:text-[17px] placeholder:font-normal placeholder:text-ink-3/60"
        />
        {unit && <span className="shrink-0 text-[16px] text-ink-2">{unit}</span>}
      </div>
      {hint && <span className="mt-1 block text-[13px] text-ink-3">{hint}</span>}
    </label>
  );
}

export const parseNum = (s: string): number | null => {
  const n = Number(s.replace(",", "."));
  return s.trim() && Number.isFinite(n) ? n : null;
};
