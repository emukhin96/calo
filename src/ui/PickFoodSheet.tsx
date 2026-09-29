"use client";

import { useEffect, useRef, useState } from "react";
import type { FoodResult } from "@/db/foods";
import type { NutrientVector } from "@/domain/nutrients";
import { Eyebrow } from "./components";

type OffItem = { code: string; nameRu: string; brand: string | null; nutrientsPer100g: NutrientVector };

const fmt = (x: number | null | undefined, digits = 1) =>
  x == null ? "—" : x.toLocaleString("ru-RU", { maximumFractionDigits: x >= 100 ? 0 : digits });

/**
 * Лист снизу «какой продукт?»: поиск по справочнику и Open Food Facts, выбор
 * возвращается вызывающему экрану (позиция разбора текста), а не создаёт запись.
 */
export function PickFoodSheet({ title, initialQuery, onPick, onClose }: { title: string; initialQuery: string; onPick: (food: FoodResult) => void; onClose: () => void }) {
  const [q, setQ] = useState(initialQuery);
  /** Результаты вместе с запросом, для которого они получены: показываем только актуальные. */
  const [found, setFound] = useState<{ q: string; items: FoodResult[] } | null>(null);
  const [off, setOff] = useState<OffItem[] | null>(null);
  const [offState, setOffState] = useState<"idle" | "loading" | "error">("idle");
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const query = q.trim();
  const items = found && found.q === query ? found.items : null;

  // Тот же поиск, что во вкладке «Продукт»; первый запрос — сразу, дальше с задержкой.
  useEffect(() => {
    const my = ++seq.current;
    if (query.length < 2) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/foods/search?q=${encodeURIComponent(query)}`).catch(() => null);
      if (my !== seq.current) return;
      const data = res?.ok ? await res.json() : { items: [] };
      setFound({ q: query, items: data.items });
      setOff(null);
      setOffState("idle");
    }, my === 1 ? 0 : 200);
    return () => clearTimeout(t);
  }, [query]);

  async function searchOff() {
    setOffState("loading");
    const res = await fetch(`/api/foods/off?q=${encodeURIComponent(q)}`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setOff(data.items ?? []);
    setOffState(res?.ok ? "idle" : "error");
  }

  /** Товар OFF сохраняется в справочник (как во вкладке «Продукт») и сразу выбирается. */
  async function pickOff(item: OffItem) {
    const res = await fetch(`/api/foods/barcode/${item.code}`);
    if (!res.ok) return;
    onPick((await res.json()) as FoodResult);
  }

  const row = (f: FoodResult) => (
    <li key={f.id}>
      <button type="button" className="w-full py-3 text-left" onClick={() => onPick(f)}>
        <div className="text-[16px] font-semibold text-ink">
          {f.nameRu}
          {f.brand && <span className="font-normal text-ink-3"> · {f.brand}</span>}
        </div>
        <div className="tabular mt-0.5 text-[14px] text-ink-2">
          {fmt(f.nutrientsPer100g.kcal, 0)} ккал · Б {fmt(f.nutrientsPer100g.protein)} · Ж {fmt(f.nutrientsPer100g.fat)} · У{" "}
          {fmt(f.nutrientsPer100g.carbs)} <span className="text-ink-3">на 100 г</span>
        </div>
      </button>
    </li>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Продукт для «${title}»`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-[var(--radius-sheet)] bg-bg px-6 pt-6 pb-[calc(16px+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 shrink-0 rounded-full bg-line" />
        <div className="flex shrink-0 items-baseline justify-between gap-3">
          <Eyebrow className="!text-[13px] truncate">продукт для «{title}»</Eyebrow>
          <button type="button" className="shrink-0 text-[15px] font-semibold text-accent" onClick={onClose}>
            Отмена
          </button>
        </div>
        <input
          autoFocus
          type="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="название продукта"
          className="mt-3 h-[52px] w-full shrink-0 rounded-[var(--radius-button)] border border-line bg-surface px-5 text-[17px] outline-none focus:border-accent"
        />
        <div className="mt-2 min-h-0 flex-auto overflow-y-auto">
          {items && items.length > 0 && <ul className="divide-y divide-line">{items.map(row)}</ul>}
          {items && items.length === 0 && (
            <p className="py-4 text-[15px] leading-relaxed text-ink-2">
              В справочнике ничего не нашлось. Попробуйте короче, одним словом: «хлеб», «сыр».
            </p>
          )}
          {items && (
            <div className="py-3">
              {off === null ? (
                <button
                  type="button"
                  onClick={searchOff}
                  disabled={offState === "loading"}
                  className="w-full rounded-[var(--radius-button)] border-2 border-accent py-3 text-[15px] font-bold text-accent disabled:opacity-50"
                >
                  {offState === "loading" ? "Ищу в Open Food Facts…" : "Искать товар в Open Food Facts"}
                </button>
              ) : (
                <>
                  <Eyebrow className="!text-[13px]">Open Food Facts · {off.length ? "выберите товар" : offState === "error" ? "не отвечает" : "ничего не нашлось"}</Eyebrow>
                  <ul className="mt-1 divide-y divide-line">
                    {off.map((o) => (
                      <li key={o.code}>
                        <button type="button" className="w-full py-3 text-left" onClick={() => pickOff(o)}>
                          <div className="text-[16px] font-semibold text-ink">
                            {o.nameRu}
                            {o.brand && <span className="font-normal text-ink-3"> · {o.brand}</span>}
                          </div>
                          <div className="tabular mt-0.5 text-[14px] text-ink-2">
                            {fmt(o.nutrientsPer100g.kcal, 0)} ккал · Б {fmt(o.nutrientsPer100g.protein)} · Ж {fmt(o.nutrientsPer100g.fat)} · У {fmt(o.nutrientsPer100g.carbs)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
