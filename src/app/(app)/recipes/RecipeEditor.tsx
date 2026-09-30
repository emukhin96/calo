"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FoodResult } from "@/db/foods";
import type { RecipeDetail, RecipeKind } from "@/db/recipes";
import { amountToGrams, parseAmount } from "@/domain/amount";
import { type NutrientVector, scale } from "@/domain/nutrients";
import { computeRecipe } from "@/domain/recipe";
import { BarcodeScanner } from "@/ui/BarcodeScanner";
import { Button, Eyebrow, SectionTitle } from "@/ui/components";
import { NumberField, parseNum, Segmented } from "@/ui/form";
import { formatInt } from "@/ui/format";
import { formatGrams } from "@/ui/grams";
import { type IngredientFood, IngredientGramsSheet } from "@/ui/IngredientGramsSheet";
import { fmtAmount } from "@/ui/nutrients";
import { OwnFoodSheet } from "@/ui/OwnFoodSheet";

type Picked = IngredientFood & { foodId: string };
type Row = Picked & { key: number; grams: number };

/** Что открыто поверх редактора: граммы ингредиента (нового или уже в блюде) или форма своего продукта. */
type Sheet =
  | { kind: "grams"; food: Picked; grams: number; rowKey?: number }
  | { kind: "own"; name: string; barcode: string; note?: string };

type OffItem = { code: string; nameRu: string; brand: string | null; nutrientsPer100g: NutrientVector };

const macros = (n: NutrientVector) =>
  `${formatInt(n.kcal ?? 0)} ккал · Б ${fmtAmount(n.protein ?? 0)} · Ж ${fmtAmount(n.fat ?? 0)} · У ${fmtAmount(n.carbs ?? 0)}`;

const portionOf = (grams: number | null, label: string | null) => {
  const g = Math.round((grams ?? 0) * 10) / 10;
  return g > 0 ? { grams: g, label: label ?? `порция ${formatGrams(g)} г` } : null;
};

const pickedOf = (f: FoodResult): Picked => ({
  foodId: f.id,
  nameRu: f.nameRu,
  brand: f.brand,
  per100g: f.nutrientsPer100g,
  portion: portionOf(f.defaultPortionG, f.portionLabel),
});

/** Редактор блюда: составное (ингредиенты) или шаблон (своё КБЖУ). */
export function RecipeEditor({ recipe, kind: initialKind }: { recipe?: RecipeDetail; kind: RecipeKind }) {
  const router = useRouter();
  const kind = recipe?.kind ?? initialKind;
  const [name, setName] = useState(recipe?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // составное
  const nextKey = useRef(recipe?.ingredients.length ?? 0);
  const [rows, setRows] = useState<Row[]>(() =>
    (recipe?.ingredients ?? []).map((i, n) => ({
      key: n,
      foodId: i.foodId,
      nameRu: i.nameRu,
      brand: i.brand,
      per100g: i.per100g,
      portion: portionOf(i.portionG, i.portionLabel),
      grams: i.grams,
    })),
  );
  const [sheet, setSheet] = useState<Sheet | null>(null);
  /** Смена ключа сбрасывает поиск ингредиента после добавления. */
  const [searchKey, setSearchKey] = useState(0);
  const rawWeight = rows.reduce((s, r) => s + r.grams, 0);
  const initialPortions =
    recipe?.totalWeightG && recipe.defaultPortionG ? Math.max(1, Math.round(recipe.totalWeightG / recipe.defaultPortionG)) : 1;
  const [total, setTotal] = useState(
    recipe?.kind === "composite" && recipe.totalWeightG && Math.abs(recipe.totalWeightG - rawWeight) > 0.5 ? String(recipe.totalWeightG) : "",
  );
  const [portions, setPortions] = useState(String(initialPortions));

  // шаблон
  const tpl = recipe?.kind === "template" ? recipe : null;
  const [basis, setBasis] = useState<"100" | "portion">("100");
  const [portionG, setPortionG] = useState(tpl?.defaultPortionG ? String(tpl.defaultPortionG) : "");
  const [kcal, setKcal] = useState(tpl ? String(tpl.nutrientsPer100g.kcal ?? "") : "");
  const [protein, setProtein] = useState(tpl ? String(tpl.nutrientsPer100g.protein ?? "") : "");
  const [fat, setFat] = useState(tpl ? String(tpl.nutrientsPer100g.fat ?? "") : "");
  const [carbs, setCarbs] = useState(tpl ? String(tpl.nutrientsPer100g.carbs ?? "") : "");

  const computed = computeRecipe(
    rows.map((r) => ({ per100g: r.per100g, grams: r.grams })),
    { totalWeightG: parseNum(total), portions: parseNum(portions) },
  );

  function templatePer100g() {
    const k = basis === "portion" ? 100 / (parseNum(portionG) ?? NaN) : 1;
    const v = (s: string) => Math.round((parseNum(s) ?? NaN) * k * 100) / 100;
    return { kcal: v(kcal), protein: v(protein), fat: v(fat), carbs: v(carbs) };
  }

  const valid =
    name.trim().length > 0 &&
    (kind === "composite"
      ? rows.length > 0 && rows.every((r) => r.grams > 0)
      : Object.values(templatePer100g()).every((x) => Number.isFinite(x) && x >= 0) &&
        (basis === "100" || (parseNum(portionG) ?? 0) > 0));

  async function save() {
    setSaving(true);
    setError("");
    const body =
      kind === "composite"
        ? {
            kind,
            name,
            ingredients: rows.map((r) => ({ foodId: r.foodId, grams: r.grams })),
            totalWeightG: parseNum(total),
            portions: parseNum(portions),
          }
        : { kind, name, per100g: templatePer100g(), defaultPortionG: parseNum(portionG) };
    const res = await fetch(recipe ? `/api/recipes/${recipe.id}` : "/api/recipes", {
      method: recipe ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Не получилось сохранить — проверьте значения");
      return;
    }
    router.push("/recipes");
    router.refresh();
  }

  async function remove() {
    if (!recipe || !confirm(`Удалить «${recipe.name}»? Записи в дневнике останутся.`)) return;
    await fetch(`/api/recipes/${recipe.id}`, { method: "DELETE" });
    router.push("/recipes");
    router.refresh();
  }

  const addRow = useCallback((food: Picked, grams: number) => {
    const key = nextKey.current++;
    setRows((prev) => [...prev, { ...food, key, grams }]);
    setSearchKey((k) => k + 1);
  }, []);

  /** Продукт выбран: количество из строки поиска («сливки 20% 50») — сразу в блюдо, иначе — лист граммов. */
  const pickFood = useCallback(
    (f: FoodResult, grams: number | null) => {
      const food = pickedOf(f);
      if (grams) addRow(food, grams);
      // Порция — ровно та, что у быстрой кнопки (12,5 г, а не 13): кнопка сразу подсвечена.
      else setSheet({ kind: "grams", food, grams: food.portion?.grams ?? 100 });
    },
    [addRow],
  );

  const openOwn = useCallback(
    (prefill: string, barcode = "", note?: string) => setSheet({ kind: "own", name: prefill, barcode, note }),
    [],
  );

  function submitGrams(grams: number) {
    if (sheet?.kind !== "grams") return;
    const { rowKey } = sheet;
    if (rowKey != null) setRows((prev) => prev.map((r) => (r.key === rowKey ? { ...r, grams } : r)));
    else addRow(sheet.food, grams);
    setSheet(null);
  }

  return (
    <main className="mx-auto max-w-xl px-6 pt-6 pb-24">
      <div className="flex items-center justify-between">
        <Eyebrow>{recipe ? "Блюдо" : kind === "composite" ? "Новое блюдо" : "Своё КБЖУ"}</Eyebrow>
        <Link href="/recipes" className="text-[16px] font-semibold text-accent">
          Отмена
        </Link>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={kind === "composite" ? "Паста со сливками" : "Сырники в кафе"}
        className="mt-3 w-full bg-transparent font-display text-[26px] font-extrabold text-ink outline-none placeholder:text-line"
      />

      {kind === "composite" ? (
        <>
          <SectionTitle>Ингредиенты</SectionTitle>
          {rows.length === 0 && (
            <p className="mb-1 text-[15px] leading-snug text-ink-2">
              Найдите продукт по названию, отсканируйте штрихкод упаковки или внесите свой — с КБЖУ с этикетки. Граммы
              выберете кнопками и ползунком.
            </p>
          )}
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const edit = () => setSheet({ kind: "grams", food: r, grams: r.grams, rowKey: r.key });
              return (
                <li key={r.key} className="flex items-center gap-2 py-1.5">
                  <button type="button" onClick={edit} className="min-w-0 flex-1 py-1.5 text-left">
                    <div className="truncate text-[16px] font-semibold text-ink">
                      {r.nameRu}
                      {r.brand && <span className="font-normal text-ink-3"> · {r.brand}</span>}
                    </div>
                    <div className="tabular truncate text-[13px] text-ink-3">{macros(scale(r.per100g, r.grams))}</div>
                  </button>
                  <button
                    type="button"
                    onClick={edit}
                    aria-label={`${r.nameRu}: ${formatGrams(r.grams)} г, изменить`}
                    className="tabular shrink-0 rounded-full border border-line bg-surface px-3.5 py-2 text-[16px] font-semibold text-ink active:bg-line/60"
                  >
                    {formatGrams(r.grams)} г
                  </button>
                  <button
                    type="button"
                    aria-label={`Убрать: ${r.nameRu}`}
                    onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                    className="flex size-11 shrink-0 items-center justify-center text-[22px] text-ink-3"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <IngredientSearch key={searchKey} onPick={pickFood} onOwn={openOwn} />

          <SectionTitle>Готовое блюдо</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Вес готового"
              unit="г"
              value={total}
              onChange={setTotal}
              placeholder={rawWeight ? formatInt(rawWeight) : "—"}
            />
            <NumberField label="Порций" value={portions} onChange={setPortions} />
          </div>
          <p className="mt-2 text-[13px] leading-snug text-ink-3">
            Взвесьте готовое блюдо: паста и крупы впитывают воду (100 г сухой пасты ≈ 250 г варёной), мясо ужаривается.
            Без веса считаем по сумме ингредиентов — {formatInt(rawWeight)} г.
          </p>

          {rows.length > 0 && (
            <div className="mt-5 rounded-2xl bg-surface p-4 text-[15px]">
              <div className="flex justify-between">
                <span className="text-ink-2">Всё блюдо, {formatInt(computed.totalWeightG)} г</span>
                <span className="tabular font-bold">{formatInt(computed.total.kcal ?? 0)} ккал</span>
              </div>
              <div className="mt-1 text-ink-3">на 100 г: {macros(computed.per100g)}</div>
              {computed.portionG && (parseNum(portions) ?? 1) > 1 && (
                <div className="mt-1 text-ink-3">
                  порция {formatInt(computed.portionG)} г: {formatInt(((computed.per100g.kcal ?? 0) * computed.portionG) / 100)} ккал
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-[15px] text-ink-2">КБЖУ с упаковки, из меню кафе или от производителя.</p>
          <div className="mt-5">
            <Segmented
              value={basis}
              options={[
                { value: "100", label: "На 100 г" },
                { value: "portion", label: "На порцию" },
              ]}
              onChange={setBasis}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <NumberField label="Калории" unit="ккал" value={kcal} onChange={setKcal} />
            <NumberField label="Белки" unit="г" value={protein} onChange={setProtein} />
            <NumberField label="Жиры" unit="г" value={fat} onChange={setFat} />
            <NumberField label="Углеводы" unit="г" value={carbs} onChange={setCarbs} />
          </div>
          <div className="mt-4">
            <NumberField
              label="Обычная порция"
              unit="г"
              value={portionG}
              onChange={setPortionG}
              placeholder={basis === "portion" ? "обязательно" : "необязательно"}
            />
          </div>
        </>
      )}

      {error && <p className="mt-4 text-[15px] text-warn">{error}</p>}
      <Button className="mt-8" disabled={!valid || saving} onClick={save}>
        {saving ? "Сохраняю…" : "Сохранить блюдо"}
      </Button>
      {recipe && (
        <button type="button" onClick={remove} className="mt-3 w-full py-3 text-[16px] font-semibold text-warn">
          Удалить блюдо
        </button>
      )}

      {sheet?.kind === "grams" && (
        <IngredientGramsSheet
          key={`${sheet.food.foodId}:${sheet.rowKey ?? "new"}`}
          food={sheet.food}
          initialGrams={sheet.grams}
          submitLabel={sheet.rowKey != null ? "Сохранить" : "Добавить в блюдо"}
          onSubmit={submitGrams}
          onRemove={
            sheet.rowKey != null
              ? () => {
                  const { rowKey } = sheet;
                  setRows((prev) => prev.filter((x) => x.key !== rowKey));
                  setSheet(null);
                }
              : undefined
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === "own" && (
        <OwnFoodSheet
          initialName={sheet.name}
          initialBarcode={sheet.barcode}
          note={sheet.note}
          onSaved={(f) => pickFood(f, null)}
          onClose={() => setSheet(null)}
        />
      )}
    </main>
  );
}

const BarcodeIcon = () => (
  <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
  </svg>
);

/**
 * Поиск ингредиента: справочник (свои продукты сверху), Open Food Facts,
 * штрихкод и свой продукт с упаковки. Выбор открывает лист граммов;
 * «сливки 20% 50» добавит 50 г сливок одним нажатием.
 */
function IngredientSearch({
  onPick,
  onOwn,
}: {
  onPick: (f: FoodResult, grams: number | null) => void;
  onOwn: (name: string, barcode?: string, note?: string) => void;
}) {
  const [q, setQ] = useState("");
  /** Результаты вместе с запросом, для которого получены: показываем только актуальные. */
  const [found, setFound] = useState<{ q: string; items: FoodResult[]; failed?: boolean } | null>(null);
  const [off, setOff] = useState<{ q: string; items: OffItem[]; state: "loading" | "done" | "error" } | null>(null);
  const [scanning, setScanning] = useState(false);
  /** Сообщение под поиском: «ищу товар…», ошибка сети (с кнопкой «Повторить» для штрихкода). */
  const [msg, setMsg] = useState<{ text: string; retry?: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const { query, amount } = parseAmount(q);
  const term = query.trim();
  const items = found && found.q === term ? found : null;
  const offNow = off && off.q === term ? off : null;

  useEffect(() => {
    const my = ++seq.current;
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/foods/search?q=${encodeURIComponent(term)}`).catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (my !== seq.current) return;
      setFound({ q: term, items: (data?.items ?? []).slice(0, 8), failed: !data });
    }, 200);
    return () => clearTimeout(t);
  }, [term]);

  function pick(f: FoodResult) {
    const grams = amount ? amountToGrams(amount, f.defaultPortionG) : null;
    input.current?.blur(); // клавиатура не должна закрывать лист граммов
    onPick(f, grams ? Math.round(grams) : null);
  }

  async function searchOff() {
    const q0 = term;
    setOff({ q: q0, items: [], state: "loading" });
    const res = await fetch(`/api/foods/off?q=${encodeURIComponent(q0)}`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setOff({ q: q0, items: data.items ?? [], state: res?.ok ? "done" : "error" });
  }

  /**
   * Товар OFF сохраняется в справочник (как во вкладке «Продукт») и сразу выбирается.
   * source=off — именно этот товар, даже если есть свой продукт с тем же штрихкодом.
   */
  async function pickOff(item: OffItem) {
    const res = await fetch(`/api/foods/barcode/${item.code}?source=off`).catch(() => null);
    if (!res?.ok) {
      setMsg({ text: "Не получилось загрузить товар из Open Food Facts — попробуйте ещё раз." });
      return;
    }
    pick((await res.json()) as FoodResult);
  }

  /** Штрихкод → свой продукт, справочник или Open Food Facts → лист граммов; нет товара — форма с упаковки. */
  const lookup = useCallback(
    async (code: string) => {
      setScanning(false);
      setMsg({ text: `Ищу товар ${code}…` });
      const res = await fetch(`/api/foods/barcode/${code}`).catch(() => null);
      if (res?.ok) {
        setMsg(null);
        onPick((await res.json()) as FoodResult, null);
      } else if (res?.status === 404) {
        setMsg(null);
        onOwn(
          "",
          code,
          `Товара ${code} нет в Open Food Facts (или там нет его КБЖУ) — перепишите КБЖУ с упаковки. В следующий раз он найдётся по штрихкоду.`,
        );
      } else if (res?.status === 400) {
        setMsg({ text: `${code} не похож на штрихкод — проверьте цифры.` });
      } else {
        setMsg({ text: "Не получилось найти товар: нет сети или Open Food Facts не отвечает.", retry: code });
      }
    },
    [onPick, onOwn],
  );

  const foodRow = (f: FoodResult) => (
    <li key={f.id}>
      <button type="button" onClick={() => pick(f)} className="w-full py-2.5 text-left">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-[16px] font-semibold text-ink">
            {f.nameRu}
            {f.brand && <span className="font-normal text-ink-3"> · {f.brand}</span>}
          </span>
          {f.own && <span className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-accent uppercase">моё</span>}
        </div>
        <div className="tabular text-[13px] text-ink-3">{macros(f.nutrientsPer100g)} на 100 г</div>
      </button>
    </li>
  );

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMsg(null);
          }}
          placeholder="+ ингредиент: «сыр 30»"
          className="h-[52px] min-w-0 flex-1 rounded-2xl border border-dashed border-line bg-surface px-4 text-[17px] outline-none focus:border-solid focus:border-accent"
        />
        <button
          type="button"
          aria-label="Сканировать штрихкод"
          onClick={() => {
            input.current?.blur(); // иначе клавиатура поиска остаётся поверх камеры
            setMsg(null);
            setScanning(true);
          }}
          className="flex size-[52px] shrink-0 items-center justify-center rounded-2xl bg-surface text-ink-2"
        >
          <BarcodeIcon />
        </button>
      </div>

      {msg && (
        <p className="mt-2 rounded-2xl bg-surface px-4 py-3 text-[15px] leading-snug text-ink-2">
          {msg.text}
          {msg.retry && (
            <button type="button" onClick={() => lookup(msg.retry!)} className="ml-2 font-semibold text-accent">
              Повторить
            </button>
          )}
        </p>
      )}
      {amount && term.length >= 2 && (
        <p className="mt-2 font-mono text-[13px] tracking-[0.04em] text-ink-3">
          {"grams" in amount ? `количество: ${amount.grams} г` : `количество: ${amount.pieces} шт`}
        </p>
      )}

      {term.length >= 2 && items && (
        <>
          {items.items.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-2xl bg-surface px-4">{items.items.map(foodRow)}</ul>
          )}
          {items.failed ? (
            <p className="mt-2 text-[15px] leading-snug text-ink-2">Нет сети — поиск недоступен.</p>
          ) : (
            <div className="mt-2">
              {items.items.length === 0 && (
                <p className="mb-2 text-[15px] leading-snug text-ink-2">
                  В справочнике ничего не нашлось. Попробуйте короче или поищите товар в Open Food Facts.
                </p>
              )}
              {!offNow || offNow.state === "loading" ? (
                <button
                  type="button"
                  onClick={searchOff}
                  disabled={offNow?.state === "loading"}
                  className="w-full rounded-2xl border-2 border-accent px-3 py-3 text-[15px] font-bold text-accent disabled:opacity-50"
                >
                  {offNow ? "Ищу в Open Food Facts…" : items.items.length ? "Нет нужного? Искать в Open Food Facts" : "Искать в Open Food Facts"}
                </button>
              ) : (
                <>
                  <Eyebrow className="mt-3 !text-[13px]">
                    Open Food Facts ·{" "}
                    {offNow.items.length ? "выберите товар" : offNow.state === "error" ? "не отвечает" : "ничего не нашлось"}
                  </Eyebrow>
                  {offNow.items.length > 0 && (
                    <ul className="mt-1 divide-y divide-line rounded-2xl bg-surface px-4">
                      {offNow.items.map((o) => (
                        <li key={o.code}>
                          <button type="button" onClick={() => pickOff(o)} className="w-full py-2.5 text-left">
                            <div className="text-[16px] font-semibold text-ink">
                              {o.nameRu}
                              {o.brand && <span className="font-normal text-ink-3"> · {o.brand}</span>}
                            </div>
                            <div className="tabular text-[13px] text-ink-3">{macros(o.nutrientsPer100g)} на 100 г</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => {
          input.current?.blur();
          onOwn(term);
        }}
        className="mt-3 py-1 text-left text-[15px] font-semibold text-accent"
      >
        + Свой продукт (КБЖУ с упаковки)
      </button>

      {scanning && <BarcodeScanner onCode={lookup} onClose={() => setScanning(false)} />}
    </div>
  );
}
