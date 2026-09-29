"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ParsedItem } from "@/ai/match";
import type { ParseTextResponse } from "@/app/api/parse/text/route";
import type { FoodResult } from "@/db/foods";
import type { Meal } from "@/domain/day";
import { scale, sum } from "@/domain/nutrients";
import { notifyChanged } from "@/lib/native";
import { postEntry } from "@/lib/offline";
import { Button, Eyebrow } from "@/ui/components";
import { formatInt, plural } from "@/ui/format";
import { PickFoodSheet } from "@/ui/PickFoodSheet";

type Row = ParsedItem & { key: string; foodId: string | null; gramsText: string; skip: boolean };

const EXAMPLES = ["паста: 100 г сухой пасты, 50 г сливок 20%, 30 г пармезана", "тарелка борща и два куска ржаного хлеба", "кефир 250, яйцо 2 шт"];

const fmt = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("ru-RU", { maximumFractionDigits: x >= 10 ? 0 : 1 }));

/**
 * Вкладка «Текст»: свободное описание → /api/parse/text → экран подтверждения
 * (позиции, граммы, выбор из топ-3 продуктов или любого через лист поиска) → записи в дневник.
 * Нутриенты берутся из выбранного продукта справочника, ИИ их не оценивает.
 */
export function TextParse({ date, meal }: { date: string; meal: Meal }) {
  const router = useRouter();
  /** Позиция, для которой открыт лист «другой продукт». */
  const [picking, setPicking] = useState<Row | null>(null);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<ParseTextResponse["source"] | null>(null);
  const [busy, setBusy] = useState<"parse" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    setBusy("parse");
    setError(null);
    try {
      const res = await fetch("/api/parse/text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      }).catch(() => null);
      if (!res) {
        setError("Нет сети — разбор текста недоступен. Добавьте продукты из недавних или «Моих блюд».");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as Partial<ParseTextResponse> & { error?: string };
      if (!res.ok || !data.items) {
        setError(data.error ?? "Не удалось разобрать текст. Попробуйте ещё раз.");
        return;
      }
      if (data.items.length === 0) {
        setError("Не нашёл в тексте продуктов. Напишите, что и сколько съели, например: «творог 180 г и банан».");
        return;
      }
      setSource(data.source ?? null);
      setRows(
        data.items.map((it, i) => ({
          ...it,
          key: `${i}-${it.name}`,
          foodId: it.candidates[0]?.id ?? null,
          gramsText: it.grams != null ? String(it.grams) : "",
          skip: false,
        })),
      );
    } finally {
      setBusy(null);
    }
  }

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);

  /** «другой…»: выбранный в листе продукт становится кандидатом позиции и сразу выбирается. */
  function replaceFood(row: Row, f: FoodResult) {
    update(row.key, { foodId: f.id, candidates: [f, ...row.candidates.filter((c) => c.id !== f.id)].slice(0, 4) });
    setPicking(null);
  }

  const food = (r: Row): FoodResult | null => r.candidates.find((c) => c.id === r.foodId) ?? null;
  const grams = (r: Row) => {
    const g = Number(r.gramsText.replace(",", "."));
    return Number.isFinite(g) && g > 0 && g <= 5000 ? g : null;
  };
  const ready = rows?.filter((r) => !r.skip && food(r) && grams(r)) ?? [];
  const unmatched = rows?.filter((r) => !r.skip && !food(r)) ?? [];
  const totals = sum(ready.map((r) => scale(food(r)!.nutrientsPer100g, grams(r)!)));

  async function save() {
    setBusy("save");
    setError(null);
    let queued = false;
    try {
      for (const r of ready) {
        const result = await postEntry({ foodId: food(r)!.id, grams: grams(r)!, meal, date }, food(r)!.nameRu);
        if (result === "queued") queued = true;
      }
    } catch {
      setError("Часть записей не сохранилась. Проверьте дневник.");
      setBusy(null);
      return;
    }
    if (queued) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- офлайн: полная загрузка дня из кэша SW
      window.location.assign(`/?d=${date}`);
      return;
    }
    notifyChanged();
    router.push(`/?d=${date}`);
    router.refresh();
  }

  if (!rows) {
    return (
      <div>
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Опишите, что съели: продукты, граммы или бытовые меры"
          className="w-full resize-none rounded-[var(--radius-button)] border border-line bg-surface px-5 py-4 text-[17px] leading-relaxed outline-none focus:border-accent"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-left text-[13px] text-ink-2"
            >
              {ex}
            </button>
          ))}
        </div>
        {error && <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[15px] text-ink-2">{error}</p>}
        <Button className="mt-5" disabled={busy != null || text.trim().length < 2} onClick={parse}>
          {busy === "parse" ? "Разбираю…" : "Разобрать"}
        </Button>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
          Если у каждой позиции указан вес, разбор проходит без ИИ. Иначе текст уходит в Gemini, который называет продукты и
          граммы; калории всегда считаются по справочнику.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <Eyebrow>
          {rows.length} {plural(rows.length, ["позиция", "позиции", "позиций"])} · {source === "ai" ? "разобрал ИИ" : "без ИИ"}
        </Eyebrow>
        <button type="button" className="text-[15px] font-semibold text-accent" onClick={() => setRows(null)}>
          Изменить текст
        </button>
      </div>

      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => {
          const f = food(r);
          const g = grams(r);
          const kcal = f && g ? scale(f.nutrientsPer100g, g).kcal : null;
          return (
            <li key={r.key} className={`py-4 ${r.skip ? "opacity-40" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-semibold text-ink">
                    {f ? f.nameRu : r.name}
                    {f?.brand && <span className="font-normal text-ink-3"> · {f.brand}</span>}
                  </div>
                  <div className="mt-0.5 text-[13px] text-ink-3">
                    «{r.sourceText || r.name}»
                    {r.confidence < 0.6 && r.grams != null && " · вес примерный"}
                    {r.state === "raw" && " · в сухом/сыром виде"}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={r.skip ? "Вернуть позицию" : "Убрать позицию"}
                  onClick={() => update(r.key, { skip: !r.skip })}
                  className="shrink-0 rounded-full border border-line px-3 py-1 text-[13px] font-semibold text-ink-2"
                >
                  {r.skip ? "Вернуть" : "Убрать"}
                </button>
              </div>

              {!r.skip && (
                <>
                  {r.candidates.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.candidates.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => update(r.key, { foodId: c.id })}
                          className={`max-w-full truncate rounded-full border px-3 py-1 text-[13px] font-semibold ${
                            c.id === r.foodId ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2"
                          }`}
                        >
                          {c.nameRu}
                          {c.brand ? ` · ${c.brand}` : ""}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setPicking(r)}
                        className="rounded-full border border-dashed border-line px-3 py-1 text-[13px] font-semibold text-accent"
                      >
                        другой…
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-[14px] text-ink-2">
                      В справочнике не нашлось.{" "}
                      <button type="button" className="font-semibold text-accent" onClick={() => setPicking(r)}>
                        Найти вручную →
                      </button>
                    </p>
                  )}

                  <div className="mt-2 flex items-baseline gap-2">
                    <input
                      aria-label={`Граммы: ${r.name}`}
                      inputMode="decimal"
                      value={r.gramsText}
                      placeholder={r.pieces ? `${r.pieces} шт — вес?` : "граммы"}
                      onChange={(e) => update(r.key, { gramsText: e.target.value.replace(/[^\d.,]/g, "") })}
                      className="tabular w-24 rounded-xl border border-line bg-surface px-3 py-1.5 text-[17px] font-bold text-ink outline-none focus:border-accent"
                    />
                    <span className="text-[15px] text-ink-2">г</span>
                    {f && (
                      <span className="tabular ml-auto text-[15px] text-ink-2">
                        {kcal != null ? formatInt(kcal) : "—"} ккал · Б {fmt(f && g ? scale(f.nutrientsPer100g, g).protein : null)} · Ж{" "}
                        {fmt(f && g ? scale(f.nutrientsPer100g, g).fat : null)} · У {fmt(f && g ? scale(f.nutrientsPer100g, g).carbs : null)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {unmatched.length > 0 && (
        <p className="mt-3 text-[14px] text-ink-3">
          {unmatched.length} {plural(unmatched.length, ["позиция", "позиции", "позиций"])} без продукта в дневник не попадёт — найдите вручную или уберите.
        </p>
      )}
      {error && <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[15px] text-ink-2">{error}</p>}

      <p className="tabular mt-5 text-[17px] font-bold text-ink">
        Итого {formatInt(totals.kcal ?? 0)} <span className="font-normal text-ink-2">ккал</span>
        <span className="ml-2 text-[15px] font-normal text-ink-2">
          Б {fmt(totals.protein)} · Ж {fmt(totals.fat)} · У {fmt(totals.carbs)}
        </span>
      </p>
      <Button className="mt-4" disabled={busy != null || ready.length === 0} onClick={save}>
        {busy === "save" ? "Сохраняю…" : `Добавить ${ready.length} ${plural(ready.length, ["позицию", "позиции", "позиций"])}`}
      </Button>

      {picking && (
        <PickFoodSheet
          title={picking.name}
          initialQuery={picking.name}
          onPick={(f) => replaceFood(picking, f)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
