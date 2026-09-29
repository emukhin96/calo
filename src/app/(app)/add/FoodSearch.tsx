"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { amountToGrams, parseAmount } from "@/domain/amount";
import type { Meal } from "@/domain/day";
import type { FoodResult } from "@/db/foods";
import { NUTRIENT_KEYS, type NutrientVector } from "@/domain/nutrients";
import { fmtAmount, NUTRIENT_LABELS, unitRu } from "@/ui/nutrients";
import { Eyebrow } from "@/ui/components";
import { PortionSheet } from "@/ui/PortionSheet";

type OffItem = { code: string; nameRu: string; brand: string | null; nutrientsPer100g: NutrientVector };

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
            <dt className="text-ink-3">{NUTRIENT_LABELS[k]}</dt>
            <dd className="tabular text-ink-2">
              {n[k] == null ? "—" : `${fmtAmount(n[k])} ${unitRu(k)}`}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type Recent = { food: FoodResult; lastGrams: number };

function portionOf(f: FoodResult) {
  return f.defaultPortionG ? { grams: f.defaultPortionG, label: f.portionLabel ?? `порция ${f.defaultPortionG} г` } : null;
}

/** Поиск продукта → лист порции → запись в дневник за день date. */
export function FoodSearch({ date, meal }: { date: string; meal: Meal }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FoodResult[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [off, setOff] = useState<OffItem[] | null>(null);
  const [offState, setOffState] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ food: FoodResult; grams: number } | null>(null);
  const seq = useRef(0);
  const { query, amount } = parseAmount(q);

  useEffect(() => {
    fetch("/api/entries/recent")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setRecent(d.items));
  }, []);

  function onQueryChange(value: string) {
    setQ(value);
    setOff(null);
    setOffState("idle");
    if (parseAmount(value).query.trim().length < 2) setItems([]);
  }

  // Поиск по своему справочнику с задержкой 200 мс; устаревшие ответы отбрасываются.
  useEffect(() => {
    const my = ++seq.current;
    if (query.trim().length < 2) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/foods/search?q=${encodeURIComponent(query)}`);
      if (my !== seq.current || !res.ok) return;
      setItems((await res.json()).items);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  /** Граммы по умолчанию: из строки («кефир 250», «яйцо 2 шт»), иначе порция, иначе 100. */
  function pick(food: FoodResult, fallback?: number) {
    const fromQuery = amount ? amountToGrams(amount, food.defaultPortionG) : null;
    setPicked({ food, grams: Math.round(fromQuery ?? fallback ?? food.defaultPortionG ?? 100) });
  }

  async function searchOff() {
    setOffState("loading");
    const res = await fetch(`/api/foods/off?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setOff(data.items ?? []);
    setOffState(res.ok ? "idle" : "error");
  }

  async function pickOff(item: OffItem) {
    const res = await fetch(`/api/foods/barcode/${item.code}`);
    if (!res.ok) return;
    const saved = (await res.json()) as FoodResult;
    setItems((prev) => [saved, ...prev.filter((f) => f.id !== saved.id)]);
    setOff((prev) => prev?.filter((o) => o.code !== item.code) ?? null);
    pick(saved);
  }

  async function addEntry(grams: number, m: Meal) {
    const res = await fetch("/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foodId: picked!.food.id, grams, meal: m, date }),
    });
    if (!res.ok) throw new Error("save failed");
    router.push(`/?d=${date}`);
    router.refresh();
  }

  const row = (f: FoodResult, onPick: () => void, note?: string) => (
    <li key={f.id} className="py-3">
      <div className="flex items-start gap-3">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onPick}>
          <div className="text-[16px] font-semibold text-ink">
            {f.nameRu}
            {f.brand && <span className="font-normal text-ink-3"> · {f.brand}</span>}
          </div>
          <div className="mt-0.5 text-[14px] text-ink-2">
            <Macros n={f.nutrientsPer100g} /> <span className="text-ink-3">{note ?? "на 100 г"}</span>
          </div>
        </button>
        <button
          type="button"
          aria-label="Состав"
          onClick={() => setOpen(open === f.id ? null : f.id)}
          className="flex shrink-0 flex-col items-end gap-1 pt-0.5"
        >
          <span className="font-mono text-[11px] tracking-[0.06em] text-ink-3 uppercase">{f.own ? "моё" : SOURCE_RU[f.source]}</span>
          <span className="flex size-6 items-center justify-center rounded-full border border-line text-[12px] text-ink-3">i</span>
        </button>
      </div>
      {open === f.id && <Details n={f.nutrientsPer100g} />}
    </li>
  );

  const showRecent = query.trim().length < 2 && recent.length > 0;

  return (
    <div>
      <input
        autoFocus
        type="search"
        enterKeyHint="search"
        placeholder="«творог 5% 180», «кефир 250», «яйцо 2 шт»"
        value={q}
        onChange={(e) => onQueryChange(e.target.value)}
        className="h-[56px] w-full rounded-[var(--radius-button)] border border-line bg-surface px-5 text-[17px] outline-none focus:border-accent"
      />
      {amount && (
        <p className="mt-2 font-mono text-[13px] tracking-[0.04em] text-ink-3">
          {"grams" in amount ? `количество: ${amount.grams} г` : `количество: ${amount.pieces} шт`}
        </p>
      )}

      {showRecent && (
        <>
          <Eyebrow className="mt-6">Недавние</Eyebrow>
          <ul className="mt-1 divide-y divide-line">
            {recent.map((r) => row(r.food, () => pick(r.food, r.lastGrams), `в прошлый раз ${r.lastGrams} г`))}
          </ul>
        </>
      )}

      <ul className="mt-4 divide-y divide-line">{items.map((f) => row(f, () => pick(f)))}</ul>

      {query.trim().length >= 2 && (
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
              <Eyebrow>Open Food Facts · {off.length ? "выберите товар" : offState === "error" ? "не отвечает" : "ничего не нашлось"}</Eyebrow>
              <ul className="mt-2 divide-y divide-line">
                {off.map((o) => (
                  <li key={o.code}>
                    <button type="button" className="w-full py-3 text-left" onClick={() => pickOff(o)}>
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

      {picked && (
        <PortionSheet
          title={picked.food.nameRu}
          subtitle={picked.food.brand ?? undefined}
          per100g={picked.food.nutrientsPer100g}
          initialGrams={picked.grams}
          initialMeal={meal}
          portion={portionOf(picked.food)}
          submitLabel="Добавить"
          onSubmit={addEntry}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}
