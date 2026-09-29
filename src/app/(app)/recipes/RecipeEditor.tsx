"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FoodResult } from "@/db/foods";
import type { RecipeDetail, RecipeKind } from "@/db/recipes";
import { amountToGrams, parseAmount } from "@/domain/amount";
import type { NutrientVector } from "@/domain/nutrients";
import { computeRecipe } from "@/domain/recipe";
import { Button, Eyebrow, SectionTitle } from "@/ui/components";
import { NumberField, parseNum, Segmented } from "@/ui/form";
import { formatInt } from "@/ui/format";
import { fmtAmount } from "@/ui/nutrients";

type Row = { key: number; foodId: string; nameRu: string; brand: string | null; per100g: NutrientVector; grams: string };

const macros = (n: NutrientVector) =>
  `${formatInt(n.kcal ?? 0)} ккал · Б ${fmtAmount(n.protein ?? 0)} · Ж ${fmtAmount(n.fat ?? 0)} · У ${fmtAmount(n.carbs ?? 0)}`;

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
      grams: String(i.grams),
    })),
  );
  const rawWeight = rows.reduce((s, r) => s + (parseNum(r.grams) ?? 0), 0);
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
    rows.map((r) => ({ per100g: r.per100g, grams: parseNum(r.grams) ?? 0 })),
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
      ? rows.length > 0 && rows.every((r) => (parseNum(r.grams) ?? 0) > 0)
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
            ingredients: rows.map((r) => ({ foodId: r.foodId, grams: parseNum(r.grams) })),
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

  function addFood(f: FoodResult, grams: number) {
    setRows((prev) => [
      ...prev,
      { key: nextKey.current++, foodId: f.id, nameRu: f.nameRu, brand: f.brand, per100g: f.nutrientsPer100g, grams: String(grams) },
    ]);
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
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">
                    {r.nameRu}
                    {r.brand && <span className="font-normal text-ink-3"> · {r.brand}</span>}
                  </div>
                  <div className="text-[12px] text-ink-3">{macros(r.per100g)} на 100 г</div>
                </div>
                <input
                  aria-label={`Граммы: ${r.nameRu}`}
                  inputMode="decimal"
                  value={r.grams}
                  onChange={(e) =>
                    setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, grams: e.target.value.replace(/[^\d.,]/g, "") } : x)))
                  }
                  className="tabular w-16 rounded-xl border border-line bg-surface px-2 py-1.5 text-right text-[15px] outline-none focus:border-accent"
                />
                <span className="text-[14px] text-ink-3">г</span>
                <button
                  type="button"
                  aria-label="Убрать"
                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                  className="text-[20px] text-ink-3"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <IngredientSearch onAdd={addFood} />

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
    </main>
  );
}

/** Поиск ингредиента: «сливки 20% 50» добавит 50 г сливок одним нажатием. */
function IngredientSearch({ onAdd }: { onAdd: (f: FoodResult, grams: number) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FoodResult[]>([]);
  const { query, amount } = parseAmount(q);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/foods/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setItems(d.items.slice(0, 8)))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  function pick(f: FoodResult) {
    const grams = (amount && amountToGrams(amount, f.defaultPortionG)) || f.defaultPortionG || 100;
    onAdd(f, Math.round(grams));
    setQ("");
    setItems([]);
  }

  return (
    <div className="mt-3">
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (parseAmount(e.target.value).query.trim().length < 2) setItems([]);
        }}
        placeholder="+ ингредиент: «сливки 20% 50», «пармезан 50»"
        className="h-[48px] w-full rounded-2xl border border-dashed border-line bg-surface px-4 text-[15px] outline-none focus:border-accent"
      />
      {items.length > 0 && (
        <ul className="mt-1 divide-y divide-line rounded-2xl bg-surface px-4">
          {items.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => pick(f)} className="w-full py-2.5 text-left">
                <div className="text-[15px] font-semibold">
                  {f.nameRu}
                  {f.brand && <span className="font-normal text-ink-3"> · {f.brand}</span>}
                </div>
                <div className="text-[12px] text-ink-3">{macros(f.nutrientsPer100g)} на 100 г</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
