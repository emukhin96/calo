"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { amountToGrams, parseAmount } from "@/domain/amount";
import { notifyChanged } from "@/lib/native";
import { cacheGet, cacheSet, postEntry } from "@/lib/offline";
import type { Meal } from "@/domain/day";
import type { FoodResult } from "@/db/foods";
import type { RecipeSummary } from "@/db/recipes";
import Link from "next/link";
import { NUTRIENT_KEYS, type NutrientVector } from "@/domain/nutrients";
import { fmtAmount, NUTRIENT_LABELS, unitRu } from "@/ui/nutrients";
import { Eyebrow } from "@/ui/components";
import { BarcodeScanner } from "@/ui/BarcodeScanner";
import { PortionSheet } from "@/ui/PortionSheet";
import { TextParse } from "./TextParse";

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

type Picked =
  | { kind: "food"; food: FoodResult; grams: number }
  | { kind: "recipe"; recipe: RecipeSummary; grams: number };

function recipePortion(r: RecipeSummary) {
  return r.defaultPortionG ? { grams: Math.round(r.defaultPortionG), label: `порция (${Math.round(r.defaultPortionG)} г)` } : null;
}

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
  const [tab, setTab] = useState<"food" | "recipes" | "text">("food");
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [foundRecipes, setFoundRecipes] = useState<RecipeSummary[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [scanning, setScanning] = useState(false);
  const [searchOffline, setSearchOffline] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const seq = useRef(0);
  const { query, amount } = parseAmount(q);

  useEffect(() => {
    fetch(`/api/recipes?meal=${meal}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setRecipes(d.items);
        cacheSet("recipes", d.items);
      })
      .catch(() => setRecipes(cacheGet<RecipeSummary[]>("recipes") ?? [])); // без сети — последний список
  }, [meal]);

  useEffect(() => {
    fetch("/api/entries/recent")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setRecent(d.items);
        cacheSet("recent", d.items);
      })
      .catch(() => setRecent(cacheGet<Recent[]>("recent") ?? []));
  }, []);

  function onQueryChange(value: string) {
    setQ(value);
    setOff(null);
    setOffState("idle");
    if (parseAmount(value).query.trim().length < 2) {
      setItems([]);
      setFoundRecipes([]);
    }
  }

  // Поиск по своему справочнику с задержкой 200 мс; устаревшие ответы отбрасываются.
  useEffect(() => {
    const my = ++seq.current;
    if (query.trim().length < 2) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/foods/search?q=${encodeURIComponent(query)}`).catch(() => null);
      if (my !== seq.current) return;
      setSearchOffline(res == null);
      if (!res?.ok) return;
      const data = await res.json();
      setItems(data.items);
      setFoundRecipes(data.recipes ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  /** Граммы по умолчанию: из строки («кефир 250», «яйцо 2 шт»), иначе порция, иначе 100. */
  function pick(food: FoodResult, fallback?: number) {
    const fromQuery = amount ? amountToGrams(amount, food.defaultPortionG) : null;
    setPicked({ kind: "food", food, grams: Math.round(fromQuery ?? fallback ?? food.defaultPortionG ?? 100) });
  }

  function pickRecipe(recipe: RecipeSummary) {
    const fromQuery = amount && "grams" in amount ? amount.grams : null;
    const pieces = amount && "pieces" in amount ? amount.pieces : 1;
    setPicked({ kind: "recipe", recipe, grams: Math.round(fromQuery ?? (recipe.defaultPortionG ?? 100) * pieces) });
  }

  /** Штрихкод → свой справочник или Open Food Facts → лист порции. */
  const onBarcode = useCallback(
    async (code: string) => {
      setScanning(false);
      setScanMsg(`Ищу товар ${code}…`);
      const res = await fetch(`/api/foods/barcode/${code}`).catch(() => null);
      if (res?.ok) {
        const food = (await res.json()) as FoodResult;
        setScanMsg(null);
        setPicked({ kind: "food", food, grams: Math.round(food.defaultPortionG ?? 100) });
      } else {
        setScanMsg(
          res?.status === 404
            ? `Товара ${code} нет в Open Food Facts или у него нет КБЖУ — найдите продукт по названию.`
            : "Open Food Facts не отвечает — попробуйте ещё раз или найдите по названию.",
        );
      }
    },
    [],
  );

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
    const p = picked!;
    const result = await postEntry(
      { ...(p.kind === "food" ? { foodId: p.food.id } : { recipeId: p.recipe.id }), grams, meal: m, date },
      p.kind === "food" ? p.food.nameRu : p.recipe.name,
    );
    if (result === "queued") {
      // Без сети клиентский переход не загрузится — открываем день из кэша service worker.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- офлайн: нужна полная загрузка из кэша SW
      window.location.assign(`/?d=${date}`);
      return;
    }
    notifyChanged();
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

  const recipeRow = (r: RecipeSummary) => (
    <li key={r.id}>
      <button type="button" className="w-full py-3 text-left" onClick={() => pickRecipe(r)}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold text-ink">{r.name}</span>
          <span className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-accent uppercase">блюдо</span>
        </div>
        <div className="mt-0.5 text-[14px] text-ink-2">
          {r.defaultPortionG ? (
            <>
              <span className="tabular">{Math.round(((r.nutrientsPer100g.kcal ?? 0) * r.defaultPortionG) / 100)} ккал</span>{" "}
              <span className="text-ink-3">за порцию {Math.round(r.defaultPortionG)} г</span>
            </>
          ) : (
            <>
              <Macros n={r.nutrientsPer100g} /> <span className="text-ink-3">на 100 г</span>
            </>
          )}
        </div>
      </button>
    </li>
  );

  const showRecent = query.trim().length < 2 && recent.length > 0;

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-line/60 p-1">
        {(
          [
            ["food", "Продукт"],
            ["text", "Текст"],
            ["recipes", `Мои блюда${recipes?.length ? ` · ${recipes.length}` : ""}`],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-xl py-2 text-[15px] font-semibold ${tab === t ? "bg-surface text-ink shadow-sm" : "text-ink-2"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Вкладка «Текст» не размонтируется: разобранный список переживает переход в «Продукт» и обратно. */}
      <div hidden={tab !== "text"}>
        <TextParse
          date={date}
          meal={meal}
          onSearch={(query) => {
            // «Найти вручную»: тот же поиск, что во вкладке «Продукт», с названием позиции.
            setTab("food");
            onQueryChange(query);
          }}
        />
      </div>
      {tab === "text" ? null : tab === "recipes" ? (
        <>
          {recipes && recipes.length > 0 ? (
            <ul className="divide-y divide-line">{recipes.map(recipeRow)}</ul>
          ) : (
            <p className="text-[15px] leading-relaxed text-ink-2">
              {recipes ? "Своих блюд пока нет. Соберите блюдо из ингредиентов или сохраните любую запись дневника." : "Загружаю…"}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[15px] font-semibold text-accent">
            <Link href="/recipes/new?kind=composite">+ Блюдо из ингредиентов</Link>
            <Link href="/recipes/new?kind=template">+ Своё КБЖУ</Link>
            <Link href="/recipes">Все блюда →</Link>
          </div>
        </>
      ) : (
      <>
      <div className="flex gap-2">
        <input
          autoFocus
          type="search"
          enterKeyHint="search"
          placeholder="«творог 5% 180», «кефир 250», «яйцо 2 шт»"
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-[56px] min-w-0 flex-1 rounded-[var(--radius-button)] border border-line bg-surface px-5 text-[17px] outline-none focus:border-accent"
        />
        <button
          type="button"
          aria-label="Сканировать штрихкод"
          onClick={() => {
            setScanMsg(null);
            setScanning(true);
          }}
          className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-[var(--radius-button)] bg-surface text-ink-2"
        >
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
            <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
          </svg>
        </button>
      </div>
      {scanMsg && <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[15px] text-ink-2">{scanMsg}</p>}
      {searchOffline && query.trim().length >= 2 && (
        <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[15px] text-ink-2">
          Нет сети — поиск недоступен. Добавить можно из недавних и «Моих блюд»: запись отправится, когда появится сеть.
        </p>
      )}
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

      {foundRecipes.length > 0 && (
        <>
          <Eyebrow className="mt-5">Мои блюда</Eyebrow>
          <ul className="divide-y divide-line">{foundRecipes.map(recipeRow)}</ul>
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

      </>
      )}

      {scanning && <BarcodeScanner onCode={onBarcode} onClose={() => setScanning(false)} />}

      {picked && (
        <PortionSheet
          title={picked.kind === "food" ? picked.food.nameRu : picked.recipe.name}
          subtitle={picked.kind === "food" ? (picked.food.brand ?? undefined) : "моё блюдо"}
          per100g={picked.kind === "food" ? picked.food.nutrientsPer100g : picked.recipe.nutrientsPer100g}
          initialGrams={picked.grams}
          initialMeal={meal}
          portion={picked.kind === "food" ? portionOf(picked.food) : recipePortion(picked.recipe)}
          submitLabel="Добавить"
          onSubmit={addEntry}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}
