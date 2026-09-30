"use client";

import { type CSSProperties, type PointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { formatGrams, holdDelay, parseGrams, sanitizeGrams, sliderMax, stepGrams } from "./grams";

type Props = {
  value: number;
  onChange: (grams: number) => void;
  /** Порция из справочника: «1 шт (55 г)», «30 g» — первая быстрая кнопка. */
  portion?: { grams: number; label: string } | null;
  /** Шаг кнопок «−» / «+», г. */
  step?: number;
  max?: number;
  quick?: number[];
};

const QUICK = [50, 100, 150, 200, 250];
/** Шаг ползунка, г. Левый край — тоже 5 г: ноль граммов добавлять незачем. */
const SLIDER_STEP = 5;

const same = (a: number, b: number) => Math.abs(a - b) < 0.05;

/**
 * Сколько граммов, без клавиатуры: «−  180 г  +» (удержание — всё быстрее),
 * ползунок и быстрые кнопки. Точное число — нажать на него и ввести; сама
 * клавиатура не выскакивает. Логика шагов и шкалы — ./grams.ts.
 */
export function GramsInput({ value, onChange, portion, step = 10, max = 5000, quick = QUICK }: Props) {
  /** Текст, пока число редактируют с клавиатуры; null — показываем value. */
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Правый край ползунка только растёт и только когда вес вышел за него (ввели
  // число, нажали «+»), — пока тянут ползунок, шкала не прыгает.
  const [range, setRange] = useState(() => sliderMax(value, portion?.grams, null, max));
  const nextRange = sliderMax(value, portion?.grams, range, max);
  if (nextRange !== range) setRange(nextRange);

  // Удержание «−» / «+»: шаг сразу, затем повторы всё чаще. Последние value и
  // onChange — в ref: таймер живёт дольше одного рендера.
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const release = useRef<AbortController | null>(null);
  /** До какого момента игнорировать click: нажатие пальцем уже сработало в pointerdown. */
  const clickGuard = useRef(0);

  const endHold = useCallback(() => {
    clearTimeout(timer.current);
    release.current?.abort();
    release.current = null;
  }, []);
  useEffect(() => endHold, [endHold]);

  /** Кнопки и ползунок меняют вес — поле ввода, если открыто, закрываем (и клавиатуру с ним). */
  function leaveText() {
    if (input.current && document.activeElement === input.current) input.current.blur();
  }

  function bump(dir: 1 | -1): boolean {
    const cur = latest.current.value;
    const next = stepGrams(cur, dir, step, max);
    if (next === cur) return false;
    latest.current.value = next;
    latest.current.onChange(next);
    return true;
  }

  function startHold(dir: 1 | -1, e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.preventDefault(); // без фокуса и выделения текста при долгом нажатии
    endHold();
    leaveText();
    clickGuard.current = Infinity;
    const ctrl = new AbortController();
    // Отпускание ловим на window: палец мог уехать с кнопки, а «−» на минимуме уже disabled.
    const up = () => {
      endHold();
      clickGuard.current = performance.now() + 500;
    };
    window.addEventListener("pointerup", up, { signal: ctrl.signal });
    window.addEventListener("pointercancel", up, { signal: ctrl.signal });
    release.current = ctrl;
    let n = 0;
    const tick = () => {
      if (bump(dir)) timer.current = setTimeout(tick, holdDelay(n++));
    };
    tick();
  }

  /** click без pointerdown перед ним — клавиатура (Enter, пробел) или скринридер. */
  function keyStep(dir: 1 | -1) {
    if (performance.now() < clickGuard.current) return;
    bump(dir);
  }

  function apply(g: number) {
    leaveText();
    onChange(g);
  }

  const shown = draft ?? formatGrams(value);
  const sliderValue = Math.min(Math.max(value, SLIDER_STEP), range);
  const fill = ((sliderValue - SLIDER_STEP) / (range - SLIDER_STEP)) * 100;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <StepButton
          label={`Меньше на ${step} г`}
          disabled={value <= step}
          onPointerDown={(e) => startHold(-1, e)}
          onClick={() => keyStep(-1)}
        >
          <path d="M5 12h14" />
        </StepButton>

        <label className="flex min-w-0 cursor-text items-baseline justify-center gap-1.5 border-b-2 border-dashed border-line px-1 pb-1 focus-within:border-accent">
          <input
            ref={input}
            aria-label="Сколько граммов"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            value={shown}
            onFocus={(e) => {
              setDraft(formatGrams(value));
              const el = e.currentTarget;
              el.select();
              // iOS иногда снимает выделение сразу после фокуса
              requestAnimationFrame(() => el === document.activeElement && el.setSelectionRange(0, el.value.length));
            }}
            onChange={(e) => {
              const text = sanitizeGrams(e.target.value);
              setDraft(text);
              const g = parseGrams(text, max);
              if (g != null) onChange(g);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={() => setDraft(null)}
            style={{ width: `${Math.max(2, shown.length) + 0.2}ch` }}
            className="tabular max-w-full min-w-0 bg-transparent text-right font-display text-[40px] leading-none font-extrabold tracking-[-0.02em] text-ink outline-none"
          />
          <span className="text-[19px] font-semibold text-ink-2">г</span>
        </label>

        <StepButton
          label={`Больше на ${step} г`}
          disabled={value >= max}
          onPointerDown={(e) => startHold(1, e)}
          onClick={() => keyStep(1)}
        >
          <path d="M5 12h14M12 5v14" />
        </StepButton>
      </div>

      <input
        type="range"
        aria-label="Граммы"
        aria-valuetext={`${formatGrams(value)} г`}
        min={SLIDER_STEP}
        max={range}
        step={SLIDER_STEP}
        value={sliderValue}
        onChange={(e) => apply(Number(e.target.value))}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        className="mt-4 block h-11 w-full cursor-pointer touch-pan-y appearance-none bg-transparent outline-none [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-accent [&::-moz-range-thumb]:size-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-accent [&::-moz-range-thumb]:bg-surface [&::-moz-range-thumb]:shadow-md [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-accent)_var(--fill),var(--color-line)_var(--fill))] [&::-webkit-slider-thumb]:mt-[-11px] [&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-accent [&::-webkit-slider-thumb]:bg-surface [&::-webkit-slider-thumb]:shadow-md focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-accent/25"
      />

      <div className="mt-2 flex flex-wrap gap-2">
        {portion && (
          <Chip active={same(value, portion.grams)} onClick={() => apply(Math.min(portion.grams, max))}>
            {portion.label}
          </Chip>
        )}
        {/* «чашка (200 мл)» и «200 г» — одна и та же кнопка дважды: остаётся порция. */}
        {quick.filter((g) => !portion || !same(g, portion.grams)).map((g) => (
          <Chip key={g} active={same(value, g)} onClick={() => apply(g)}>
            {g} г
          </Chip>
        ))}
      </div>
    </div>
  );
}

function StepButton({
  label,
  disabled,
  onPointerDown,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      className="flex size-14 shrink-0 touch-manipulation items-center justify-center rounded-full border border-line bg-surface text-accent transition select-none active:scale-95 active:bg-line/60 disabled:opacity-35 [-webkit-touch-callout:none]"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`tabular max-w-full truncate rounded-full border px-3.5 py-2 text-[14px] font-semibold ${
        active ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2"
      }`}
    >
      {children}
    </button>
  );
}
