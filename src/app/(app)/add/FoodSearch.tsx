"use client";

import { useEffect, useRef, useState } from "react";
import type { FoodResult } from "@/db/foods";
import { NUTRIENT_KEYS, NUTRIENT_UNITS, type NutrientKey, type NutrientVector } from "@/domain/nutrients";
import { Eyebrow } from "@/ui/components";

type OffItem = { code: string; nameRu: string; brand: string | null; nutrientsPer100g: NutrientVector };

const LABELS: Record<NutrientKey, string> = {
  kcal: "Энергия", protein: "Белки", fat: "Жиры", carbs: "Углеводы", fiber: "Клетчатка", sugar: "Сахара",
  vitA: "Витамин A", vitC: "Витамин C", vitD: "Витамин D", vitE: "Витамин E", vitK: "Витамин K",
  b1: "B1", b2: "B2", b6: "B6", b9: "B9 (фолат)", b12: "B12",
  calcium: "Кальций", iron: "Железо", magnesium: "Магний", potassium: "Калий", sodium: "Натрий",
  zinc: "Цинк", selenium: "Селен", omega3: "Омега-3",
};
const UNIT_RU = { kcal: "ккал", g: "г", mg: "мг", "µg": "мкг" } as const;
const SOURCE_RU = { usda: "USDA", off: "OFF", manual: "моё", ai_estimate: "оценка" } as const;

const fmt = (x: number | null | undefined, digits = 1) =>
  x == null ? "—" : x.toLocaleString("ru-RU", { maximumFractionDigits: x >= 100 ? 0 : digits });

function Macros({ n }: { n: NutrientVector }) {
  return (
    <span className="tabular">
      {fmt(n.kcal, 0)} ккал · Б {fmt(n.protein)} · Ж {fmt(n.fat)} · У {fmt(n.carbs)}
    </span>
  );
}

function Details({ n }: { n: NutrientVector }) {
  const rows = NUTRIENT_KEYS.filter((k) => !["kcal", "protein", "fat", "carbs"].includes(k));
  const known = rows.filter((k) => n[k] != null);
  return (
    <div className="mt-3 rounded-xl bg-bg p-3">
      <Eyebrow className="!text-[12px]">на 100 г · известно {known.length} из {rows.length}</Eyebrow>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[14px]">
        {rows.map((k) => (
          <div key={k} className="flex justify-between">
            <dt className="text-ink-3">{LABELS[k]}</dt>
            <dd className="tabular text-ink-2">
              {n[k] == null ? "—" : `${fmt(n[k], 2)} ${UNIT_RU[NUTRIENT_UNITS[k]]}`}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FoodSearch() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FoodResult[]>([]);
  const [off, setOff] = useState<OffItem[] | null>(null);
  const [offState, setOffState] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState<string | null>(null);
  const seq = useRef(0);

  function onQueryChange(value: string) {
    setQ(value);
    setOff(null);
    setOffState("idle");
    if (value.trim().length < 2) setItems([]);
  }

  // Поиск по своему справочнику с задержкой 200 мс; устаревшие ответы отбрасываются.
  useEffect(() => {
    const my = ++seq.current;
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}`);
      if (my !== seq.current || !res.ok) return;
      setItems((await res.json()).items);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function searchOff() {
    setOffState("loading");
    const res = await fetch(`/api/foods/off?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setOff(data.items ?? []);
    setOffState(res.ok ? "idle" : "error");
  }

  async function saveOff(item: OffItem) {
    const res = await fetch(`/api/foods/barcode/${item.code}`);
    if (!res.ok) return;
    const saved = (await res.json()) as FoodResult;
    setItems((prev) => [saved, ...prev.filter((f) => f.id !== saved.id)]);
    setOff((prev) => prev?.filter((o) => o.code !== item.code) ?? null);
    setOpen(saved.id);
  }

  return (
    <div>
      <input
        autoFocus
        type="search"
        enterKeyHint="search"
        placeholder="Продукт: «сливки 20», «гречка», «rummo»"
        value={q}
        onChange={(e) => onQueryChange(e.target.value)}
        className="h-[56px] w-full rounded-[var(--radius-button)] border border-line bg-surface px-5 text-[17px] outline-none focus:border-accent"
      />

      <ul className="mt-4 divide-y divide-line">
        {items.map((f) => (
          <li key={f.id} className="py-3">
            <button type="button" className="w-full text-left" onClick={() => setOpen(open === f.id ? null : f.id)}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[16px] font-semibold text-ink">
                  {f.nameRu}
                  {f.brand && <span className="font-normal text-ink-3"> · {f.brand}</span>}
                </span>
                <span className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-ink-3 uppercase">
                  {f.own ? "моё" : SOURCE_RU[f.source]}
                </span>
              </div>
              <div className="mt-0.5 text-[14px] text-ink-2">
                <Macros n={f.nutrientsPer100g} /> <span className="text-ink-3">на 100 г</span>
              </div>
            </button>
            {open === f.id && <Details n={f.nutrientsPer100g} />}
          </li>
        ))}
      </ul>

      {q.trim().length >= 2 && (
        <div className="mt-6">
          {off === null ? (
            <button
              type="button"
              onClick={searchOff}
              disabled={offState === "loading"}
              className="w-full rounded-[var(--radius-button)] border-2 border-accent py-3.5 text-[16px] font-bold text-accent disabled:opacity-50"
            >
              {offState === "loading" ? "Ищу в Open Food Facts…" : items.length ? "Нет нужного? Искать товар в Open Food Facts" : "Искать товар в Open Food Facts"}
            </button>
          ) : (
            <>
              <Eyebrow>Open Food Facts · {off.length ? "нажмите, чтобы сохранить" : offState === "error" ? "не отвечает" : "ничего не нашлось"}</Eyebrow>
              <ul className="mt-2 divide-y divide-line">
                {off.map((o) => (
                  <li key={o.code}>
                    <button type="button" className="w-full py-3 text-left" onClick={() => saveOff(o)}>
                      <div className="text-[16px] font-semibold text-ink">
                        {o.nameRu}
                        {o.brand && <span className="font-normal text-ink-3"> · {o.brand}</span>}
                      </div>
                      <div className="mt-0.5 text-[14px] text-ink-2">
                        <Macros n={o.nutrientsPer100g} />
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
  );
}
