"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { amountToGrams, parseAmount } from "@/domain/amount";
import { notifyChanged } from "@/lib/native";
import { cacheGet, cacheSet, postEntry } from "@/lib/offline";
import { type DayMeal, defaultMealChoice, type MealChoice, mealChoiceBody, newMealTime } from "@/lib/meal-choice";
import type { FoodResult } from "@/db/foods";
import type { RecipeSummary } from "@/db/recipes";
import Link from "next/link";
import { NUTRIENT_KEYS, type NutrientVector } from "@/domain/nutrients";
import { fmtAmount, NUTRIENT_LABELS, unitRu } from "@/ui/nutrients";
import { Eyebrow } from "@/ui/components";
import { BarcodeScanner } from "@/ui/BarcodeScanner";
import { OwnFoodSheet } from "@/ui/OwnFoodSheet";
import { PortionSheet } from "@/ui/PortionSheet";
import { type AddTab, choiceMealName, type PreferredMeal } from "./add-flow";
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
      {/* Две колонки — только где «B2 (рибофлавин) 0,35 мг» умещается в половину: на 375 px слово
          рвалось посередине, а на 320 px значение уезжало за край карточки. */}
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[14px] leading-snug min-[400px]:grid-cols-2">
        {rows.map((k) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <dt className="min-w-0 text-ink-3">{NUTRIENT_LABELS[k]}</dt>
            <dd className="tabular shrink-0 text-ink-2">
              {n[k] == null ? "—" : `${fmtAmount(n[k])} ${unitRu(k)}`}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type Recent = { food: FoodResult; lastGrams: number };

type Item = { kind: "food"; food: FoodResult } | { kind: "recipe"; recipe: RecipeSummary };

/** Что открыто в листе порции; приём по умолчанию и время нового — на момент открытия. */
type Picked = Item & { grams: number; meal: MealChoice; newTime: string | undefined };

/** Свой продукт «КБЖУ с упаковки»: из поиска (название) или после неизвестного штрихкода. */
type Own = { name: string; barcode: string; note?: string };

/** Сообщение под поиском: «ищу товар…», нет товара (с формой своего продукта), ошибка сети (с повтором). */
type ScanMsg = { text: string; own?: string; retry?: string };

function recipePortion(r: RecipeSummary) {
  return r.defaultPortionG ? { grams: Math.round(r.defaultPortionG), label: `порция (${Math.round(r.defaultPortionG)} г)` } : null;
}

/** Граммы по умолчанию — до 0,1 г, как их показывает поле: дробная порция (12,5 г) совпадает со своей кнопкой. */
const round1 = (g: number) => Math.round(g * 10) / 10;

function portionOf(f: FoodResult) {
  return f.defaultPortionG ? { grams: f.defaultPortionG, label: f.portionLabel ?? `порция ${f.defaultPortionG} г` } : null;
}

const TABS: [AddTab, string][] = [
  ["food", "Продукт"],
  ["text", "Текст"],
  ["recipes", "Мои блюда"],
];

/**
 * Поиск продукта → лист порции → запись в дневник за день date. meals — приёмы
 * дня по порядку (с сервера), plan — свой список приёмов из Профиля (новый приём
 * встаёт на место по нему), showTimes — показ времени приёмов включён в Профиле;
 * preferred — приём из ссылки «добавить в этот приём».
 */
export function FoodSearch({
  date,
  meals,
  plan,
  showTimes,
  isToday,
  preferred,
  initialTab = "food",
  initialText,
}: {
  date: string;
  meals: DayMeal[];
  plan: string[];
  showTimes: boolean;
  isToday: boolean;
  preferred: PreferredMeal | null;
  initialTab?: AddTab;
  /** Текст из строки ввода дневника — вкладка «Текст» сразу его разбирает. */
  initialText?: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FoodResult[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [off, setOff] = useState<OffItem[] | null>(null);
  const [offState, setOffState] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<AddTab>(initialTab);
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [foundRecipes, setFoundRecipes] = useState<RecipeSummary[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [own, setOwn] = useState<Own | null>(null);
  const [scanning, setScanning] = useState(false);
  const [searchOffline, setSearchOffline] = useState(false);
  const [scanMsg, setScanMsg] = useState<ScanMsg | null>(null);
  const seq = useRef(0);
  const { query, amount } = parseAmount(q);

  /** Приём по умолчанию и время нового приёма — «сейчас» считаем в момент выбора продукта. */
  const mealDefaults = useCallback(
    () => ({ meal: defaultMealChoice({ meals, plan, isToday, preferred }), newTime: newMealTime(isToday) }),
    [meals, plan, isToday, preferred],
  );
  // Лист уже открыт — поздний ответ (штрихкод, товар OFF) его не подменяет: лист
  // читает граммы и приём один раз, и чужой продукт записался бы с ними.
  const openPortion = useCallback(
    (item: Item, grams: number) => {
      const next = { ...item, grams, ...mealDefaults() };
      setPicked((cur) => cur ?? next);
    },
    [mealDefaults],
  );
  // openPortion новый после каждого обновления страницы с сервера (приёмы дня) —
  // стабильный onBarcode (и повтор поиска кода) берёт свежий из ref.
  const openRef = useRef(openPortion);
  useEffect(() => {
    openRef.current = openPortion;
  });

  // «Мои блюда» — вероятные для приёма сверху: из ссылки, иначе для того, что предложим по умолчанию
  // (начатый только что приём или следующий по списку). Зависим от названия, а не от приёмов дня:
  // обновление страницы с сервера (возврат в приложение) не перезапрашивает список.
  const recipesFor = choiceMealName(mealDefaults().meal, meals);
  useEffect(() => {
    fetch(recipesFor ? `/api/recipes?mealName=${encodeURIComponent(recipesFor)}` : "/api/recipes")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setRecipes(d.items);
        cacheSet("recipes", d.items);
      })
      .catch(() => setRecipes(cacheGet<RecipeSummary[]>("recipes") ?? [])); // без сети — последний список
  }, [recipesFor]);

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
    openPortion({ kind: "food", food }, round1(fromQuery ?? fallback ?? food.defaultPortionG ?? 100));
  }

  function pickRecipe(recipe: RecipeSummary) {
    const fromQuery = amount && "grams" in amount ? amount.grams : null;
    const pieces = amount && "pieces" in amount ? amount.pieces : 1;
    openPortion({ kind: "recipe", recipe }, Math.round(fromQuery ?? (recipe.defaultPortionG ?? 100) * pieces));
  }

  /** Штрихкод → свой справочник или Open Food Facts → лист порции; нет товара — КБЖУ с упаковки. */
  const onBarcode = useCallback(
    async (code: string) => {
      setScanning(false);
      setScanMsg({ text: `Ищу товар ${code}…` });
      const res = await fetch(`/api/foods/barcode/${code}`).catch(() => null);
      if (res?.ok) {
        const food = (await res.json()) as FoodResult;
        setScanMsg(null);
        openRef.current({ kind: "food", food }, round1(food.defaultPortionG ?? 100));
      } else if (res?.status === 404) {
        setScanMsg({ text: `Товара ${code} нет в Open Food Facts или у него нет КБЖУ.`, own: code });
      } else if (res?.status === 400) {
        setScanMsg({ text: `${code} не похож на штрихкод — проверьте цифры.` });
      } else {
        setScanMsg({ text: "Не получилось найти товар: нет сети или Open Food Facts не отвечает.", retry: code });
      }
    },
    [],
  );

  /** Свой продукт сохранён — сразу лист порции; в списке поиска он тоже появляется. */
  function onOwnSaved(food: FoodResult) {
    const fromBarcode = own?.barcode;
    setOwn(null);
    setScanMsg(null);
    setItems((prev) => [food, ...prev.filter((f) => f.id !== food.id)]);
    if (fromBarcode) openPortion({ kind: "food", food }, round1(food.defaultPortionG ?? 100));
    else pick(food);
  }

  async function searchOff() {
    setOffState("loading");
    const res = await fetch(`/api/foods/off?q=${encodeURIComponent(query)}`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setOff(data.items ?? []);
    setOffState(res?.ok ? "idle" : "error");
  }

  async function pickOff(item: OffItem) {
    const res = await fetch(`/api/foods/barcode/${item.code}`).catch(() => null);
    if (!res?.ok) return;
    const saved = (await res.json()) as FoodResult;
    setItems((prev) => [saved, ...prev.filter((f) => f.id !== saved.id)]);
    setOff((prev) => prev?.filter((o) => o.code !== item.code) ?? null);
    pick(saved);
  }

  async function addEntry(grams: number, choice: MealChoice) {
    const p = picked!;
    const result = await postEntry(
      { ...(p.kind === "food" ? { foodId: p.food.id } : { recipeId: p.recipe.id }), grams, date, ...mealChoiceBody(choice) },
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
          <span className="min-w-0 text-[16px] font-semibold text-ink">{r.name}</span>
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
        {TABS.map(([t, label]) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`truncate rounded-xl px-1 py-2 text-[15px] font-semibold max-[360px]:text-[14px] ${
              tab === t ? "bg-surface text-ink shadow-sm" : "text-ink-2"
            }`}
          >
            {label}
            {/* Счётчик блюд — только когда умещается: на 320 px «Мои блюда · 12» переносилось. */}
            {t === "recipes" && recipes?.length ? <span className="max-[400px]:hidden"> · {recipes.length}</span> : null}
          </button>
        ))}
      </div>

      {/* Вкладка «Текст» не размонтируется: разобранный список переживает переход в «Продукт» и обратно. */}
      <div hidden={tab !== "text"}>
        <TextParse
          date={date}
          meals={meals}
          plan={plan}
          showTimes={showTimes}
          isToday={isToday}
          preferred={preferred}
          initialText={initialText}
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
            // Клавиатура поиска не должна оставаться поверх камеры.
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
      {scanMsg && (
        <div className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[15px] leading-snug text-ink-2">
          {scanMsg.text}
          {scanMsg.retry && (
            <button type="button" onClick={() => onBarcode(scanMsg.retry!)} className="ml-2 font-semibold text-accent">
              Повторить
            </button>
          )}
          {scanMsg.own && (
            <>
              <span> Перепишите КБЖУ с упаковки — в следующий раз товар найдётся по штрихкоду.</span>
              <button
                type="button"
                onClick={() =>
                  setOwn({
                    name: "",
                    barcode: scanMsg.own!,
                    note: `Товара ${scanMsg.own} нет в Open Food Facts (или там нет его КБЖУ) — перепишите КБЖУ с упаковки.`,
                  })
                }
                className="mt-3 flex h-12 w-full items-center justify-center rounded-[var(--radius-button)] bg-accent text-[16px] font-bold text-white active:bg-accent-press"
              >
                Внести КБЖУ с упаковки
              </button>
            </>
          )}
        </div>
      )}
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
              className="w-full rounded-[var(--radius-button)] border-2 border-accent px-3 py-3.5 text-[16px] font-bold text-accent disabled:opacity-50"
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
          {/* Нет ни в справочнике, ни в OFF — переписать КБЖУ с упаковки. */}
          <button
            type="button"
            onClick={() => setOwn({ name: query.trim(), barcode: "" })}
            className="mt-3 py-1 text-left text-[15px] font-semibold text-accent"
          >
            + Свой продукт (КБЖУ с упаковки)
          </button>
        </div>
      )}

      </>
      )}

      {scanning && <BarcodeScanner onCode={onBarcode} onClose={() => setScanning(false)} />}

      {own && (
        <OwnFoodSheet
          initialName={own.name}
          initialBarcode={own.barcode}
          note={own.note}
          onSaved={onOwnSaved}
          onClose={() => setOwn(null)}
        />
      )}

      {picked && (
        <PortionSheet
          title={picked.kind === "food" ? picked.food.nameRu : picked.recipe.name}
          subtitle={picked.kind === "food" ? (picked.food.brand ?? undefined) : "моё блюдо"}
          per100g={picked.kind === "food" ? picked.food.nutrientsPer100g : picked.recipe.nutrientsPer100g}
          initialGrams={picked.grams}
          portion={picked.kind === "food" ? portionOf(picked.food) : recipePortion(picked.recipe)}
          meals={meals}
          plan={plan}
          showTimes={showTimes}
          initialMeal={picked.meal}
          defaultNewTime={picked.newTime}
          submitLabel="Добавить"
          onSubmit={addEntry}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}
