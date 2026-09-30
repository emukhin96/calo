import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatInt } from "./format";

/** Моноширинная подпись с разрядкой: «Неделя позади», «7 из 7 дней». */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-mono text-[15px] tracking-[0.06em] text-ink-3 ${className}`}>{children}</p>
  );
}

/** Крупное число + подпись справа по базовой линии: «2 458 ккал в день · норма 2 450». */
export function BigNumber({ value, caption }: { value: number; caption?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5">
      <span className="tabular font-display text-[44px] leading-[1.1] font-extrabold tracking-[-0.02em] text-ink">
        {formatInt(value)}
      </span>
      {caption && <span className="text-[14px] text-ink-2">{caption}</span>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-9 mb-4 text-[19px] font-bold text-ink">{children}</h2>;
}

type Mark = "ok" | "warn" | "leaf";

function MarkIcon({ kind }: { kind: Mark }) {
  if (kind === "ok")
    return (
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-label="получилось">
        <circle cx="12" cy="12" r="11" fill="var(--color-ok)" />
        <path d="m7 12.5 3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "warn")
    return (
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-label="внимание">
        <circle cx="12" cy="12" r="11" fill="var(--color-warn)" />
        <path d="M12 6.5v7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="12" cy="17.2" r="1.5" fill="#fff" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-label="совет">
      <path d="M3 5.5c7-2 14.5-.5 18 6.5-5.5 2.5-12 3-18-.5 3 .3 6 .1 9-1.2C9 8.6 6 7 3 5.5Z" fill="var(--color-accent)" />
      <path d="M4 12.8c5.7 3 11.5 3.3 17 .7-1.6 4.5-6.8 7-11.6 5.5A8.6 8.6 0 0 1 4 12.8Z" fill="var(--color-accent)" />
    </svg>
  );
}

/** Список с иконками: зелёная галочка, оранжевый «!» или синий лист. */
export function MarkList({ kind, items }: { kind: Mark; items: ReactNode[] }) {
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li key={i} className="flex gap-4 text-[16px] leading-[1.45] text-ink-2">
          <span className="pt-px">
            <MarkIcon kind={kind} />
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

const buttonClass =
  "flex h-[60px] w-full items-center justify-center rounded-[var(--radius-button)] bg-accent text-[19px] font-bold text-white transition active:scale-[0.99] active:bg-accent-press disabled:opacity-50";

export function Button(props: ComponentProps<"button">) {
  return <button {...props} className={`${buttonClass} ${props.className ?? ""}`} />;
}

export function ButtonLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} className={`${buttonClass} ${props.className ?? ""}`} />;
}

/**
 * Лист снизу, как на скриншоте: серый фон сверху, скруглённый светлый лист до низа экрана.
 * Серый фон заходит под чёлку (-mt на отступ body), поэтому высота ровно 100dvh:
 * короткий разбор не прокручивается.
 */
export function Sheet({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="-mt-[env(safe-area-inset-top)] flex min-h-dvh flex-col bg-backdrop pt-[calc(12px+env(safe-area-inset-top))]">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col rounded-t-[var(--radius-sheet)] bg-bg px-6 pt-7 pb-[calc(32px+env(safe-area-inset-bottom))]">
        <div className="flex-1">{children}</div>
        {footer && <div className="pt-8">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Липкая панель внизу экрана под главную кнопку («Дальше», «Сохранить»): не налезает
 * на контент, контент уходит под неё с мягким затуханием; снизу — отступ под индикатор
 * «Домой». Ставится последним ребёнком колонки на всю высоту (min-h-app flex-col)
 * с отступами px-6 — полоса фона растягивается на них через -mx-6. Перед ней контенту
 * нужен запас снизу (pb-6), чтобы затухание в конце прокрутки ложилось на пустое место.
 */
export function BottomBar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-bottom-bar
      className={`sticky bottom-0 z-10 -mx-6 bg-bg px-6 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-b before:from-bg/0 before:to-bg ${className}`}
    >
      {children}
    </div>
  );
}

/** Полоска прогресса нутриента: «Белок 96 / 130 г». */
export function MacroBar({ label, value, norm, unit = "г", color }: { label: string; value: number; norm: number; unit?: string; color: string }) {
  const pct = Math.min(100, (value / norm) * 100);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[15px]">
        <span className="font-semibold text-ink">{label}</span>
        <span className="tabular text-ink-2">
          {formatInt(value)} / {formatInt(norm)} {unit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
