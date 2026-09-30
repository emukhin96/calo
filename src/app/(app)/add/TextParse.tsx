"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { ParsedItem } from "@/ai/match";
import type { ParseTextResponse } from "@/app/api/parse/text/route";
import type { FoodResult } from "@/db/foods";
import { amountToGrams } from "@/domain/amount";
import { scale, sum } from "@/domain/nutrients";
import {
  type DayMeal,
  defaultMealChoice,
  isMealChoiceValid,
  type MealChoice,
  newMealChoice,
  newMealTime,
} from "@/lib/meal-choice";
import { notifyChanged } from "@/lib/native";
import { postEntry } from "@/lib/offline";
import { Button, Eyebrow } from "@/ui/components";
import { formatInt, plural } from "@/ui/format";
import { formatGrams } from "@/ui/grams";
import { MealPicker } from "@/ui/MealPicker";
import { PickFoodSheet } from "@/ui/PickFoodSheet";
import { type FirstMeal, type PreferredMeal, rowMealBody, TEXT_MAX } from "./add-flow";
import { RowGramsSheet } from "./RowGramsSheet";

/**
 * Позиция экрана подтверждения. grams — сколько запишем (null — ИИ не понял
 * вес, нужно указать); gramsSet — граммы указали сами, смена продукта их не трогает.
 */
type Row = Omit<ParsedItem, "grams"> & { key: string; foodId: string | null; grams: number | null; gramsSet: boolean; skip: boolean };

/** Выбранный приём для всех позиций; touched — выбрали сами, повторный разбор его не сбрасывает. */
type MealState = { choice: MealChoice; newTime: string | undefined; touched: boolean };

/** Столько же принимает POST /api/entries. */
const MAX_GRAMS = 5000;
const okGrams = (g: number | null): g is number => g != null && g > 0 && g <= MAX_GRAMS;
const round1 = (g: number) => Math.round(g * 10) / 10;

const EXAMPLES = ["паста: 100 г сухой пасты, 50 г сливок 20%, 30 г пармезана", "тарелка борща и два куска ржаного хлеба", "кефир 250, яйцо 2 шт"];

const fmt = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("ru-RU", { maximumFractionDigits: x >= 10 ? 0 : 1 }));

/** Вес «2 шт» по порции выбранного продукта. */
const piecesGrams = (r: Row, f: FoodResult | null) => (r.pieces && f ? amountToGrams({ pieces: r.pieces }, f.defaultPortionG) : null);

/**
 * Вкладка «Текст»: свободное описание → /api/parse/text → экран подтверждения
 * (позиции, граммы, выбор из топ-3 продуктов или любого через лист поиска,
 * приём пищи) → записи в дневник. Нутриенты берутся из выбранного продукта
 * справочника, ИИ их не оценивает. initialText — из строки ввода дневника
 * (/add?text=…): разбор начинается сам, один раз.
 */
export function TextParse({
  date,
  meals,
  plan,
  showTimes,
  isToday,
  preferred,
  initialText,
}: {
  date: string;
  /** Приёмы дня по порядку. */
  meals: DayMeal[];
  /** Свой список приёмов из Профиля. */
  plan: string[];
  /** Показ времени приёмов включён в Профиле. */
  showTimes: boolean;
  isToday: boolean;
  /** Приём из ссылки «добавить в этот приём». */
  preferred: PreferredMeal | null;
  initialText?: string | null;
}) {
  const router = useRouter();
  /** Позиция, для которой открыт лист «другой продукт». */
  const [picking, setPicking] = useState<Row | null>(null);
  /** Позиция, для которой открыт лист граммов. */
  const [weighing, setWeighing] = useState<string | null>(null);
  const [text, setText] = useState(initialText ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<ParseTextResponse["source"] | null>(null);
  const [meal, setMeal] = useState<MealState | null>(null);
  const [busy, setBusy] = useState<"parse" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function parse(input: string) {
    setBusy("parse");
    setError(null);
    try {
      const res = await fetch("/api/parse/text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: input }),
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
          grams: okGrams(it.grams) ? it.grams : null,
          gramsSet: false,
          skip: false,
        })),
      );
      // Приём по умолчанию — на момент разбора: «сейчас» не устаревает, пока вкладка висела открытой.
      const fresh: MealState = {
        choice: defaultMealChoice({ meals, plan, isToday, preferred }),
        newTime: newMealTime(isToday),
        touched: false,
      };
      setMeal((m) => (m?.touched ? m : fresh));
    } finally {
      setBusy(null);
    }
  }

  // Текст из строки ввода дневника: разбор сам, ровно один раз (StrictMode вызывает
  // эффект дважды — ref не даёт отправить второй запрос к ИИ). ?text= из адреса
  // убираем: перезагрузка или «назад» не должны снова тратить запрос.
  const autoParsed = useRef(false);
  const autoParse = useEffectEvent((input: string) => {
    // «Назад» возвращает страницу из кэша роутера со старым initialText, хотя в
    // адресе ?text= уже нет, — тогда текст только подставлен, без запроса.
    if (!new URL(window.location.href).searchParams.has("text")) return;
    void parse(input);
    // Задачей позже: при полной загрузке страницы этот эффект срабатывает раньше,
    // чем Next подключается к history (эффект предка), и замена адреса прошла бы
    // мимо роутера — запись истории без его состояния, «назад» на неё не работает.
    setTimeout(() => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("text")) return;
      url.searchParams.delete("text");
      url.searchParams.set("tab", "text");
      window.history.replaceState(null, "", url);
    }, 0);
  });
  useEffect(() => {
    if (!initialText || autoParsed.current) return;
    autoParsed.current = true;
    autoParse(initialText);
  }, [initialText]);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);

  /**
   * Другой продукт позиции; «2 шт», вес которых не указан вручную, — пересчитываются
   * по его порции. Порции нет — вес прежнего продукта не годится: «указать граммы».
   */
  function chooseFood(r: Row, f: FoodResult, candidates = r.candidates) {
    const byPieces = r.pieces && !r.gramsSet ? piecesGrams(r, f) : undefined;
    const grams = byPieces === undefined ? {} : { grams: okGrams(byPieces) ? round1(byPieces) : null };
    update(r.key, { foodId: f.id, candidates, ...grams });
  }

  /** «другой…»: выбранный в листе продукт становится кандидатом позиции и сразу выбирается. */
  function replaceFood(row: Row, f: FoodResult) {
    chooseFood(row, f, [f, ...row.candidates.filter((c) => c.id !== f.id)].slice(0, 4));
    setPicking(null);
  }

  const food = (r: Row): FoodResult | null => r.candidates.find((c) => c.id === r.foodId) ?? null;
  const ready = rows?.filter((r) => !r.skip && food(r) && okGrams(r.grams)) ?? [];
  const unmatched = rows?.filter((r) => !r.skip && !food(r)) ?? [];
  const noGrams = rows?.filter((r) => !r.skip && food(r) && !okGrams(r.grams)) ?? [];
  const totals = sum(ready.map((r) => scale(food(r)!.nutrientsPer100g, r.grams!)));
  const canSave = busy == null && ready.length > 0 && meal != null && isMealChoiceValid(meal.choice);

  async function save() {
    if (!canSave) return;
    setBusy("save");
    setError(null);
    // Все позиции — в один приём: новый создаёт первая, остальные идут в него по id
    // из её ответа (add-flow rowMealBody), иначе каждая начала бы свой приём. Есть ли
    // такой приём в дне — по приёмам сейчас (день могли обновить, пока экран открыт).
    const choice = meal.choice.kind === "new" ? newMealChoice(meals, meal.choice.name, meal.choice.time) : meal.choice;
    let first: FirstMeal = undefined;
    const saved = new Set<string>();
    let queued = false;
    try {
      for (const r of ready) {
        const f = food(r)!;
        const sent = await postEntry({ foodId: f.id, grams: r.grams!, date, ...rowMealBody(choice, first) }, f.nameRu);
        if (sent === "queued") queued = true;
        // Новый приём создала первая позиция — его id; ушла в очередь — неизвестен (null).
        if (choice.kind === "new" && first === undefined) first = sent === "queued" ? null : sent.mealId;
        saved.add(r.key);
      }
    } catch {
      // Сохранённые убираем из списка: повторное нажатие не задвоит их в дневнике.
      setRows((rs) => rs?.filter((r) => !saved.has(r.key)) ?? null);
      if (saved.size > 0) notifyChanged();
      // Новый приём уже создан — остальные позиции при повторе идут в него же, а не
      // в ещё один новый: выбираем его и подтягиваем приёмы дня с сервера.
      if (first) {
        const mealId = first;
        setMeal((m) => m && { ...m, choice: { kind: "existing", mealId, name: m.choice.name }, touched: true });
        router.refresh();
      }
      setError(
        saved.size
          ? `${saved.size} из ${ready.length} сохранено, остальные — в списке. Попробуйте ещё раз.`
          : "Не получилось сохранить — попробуйте ещё раз.",
      );
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
          maxLength={TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Опишите, что съели: продукты, граммы или бытовые меры"
          className="w-full resize-none rounded-[var(--radius-button)] border border-line bg-surface px-5 py-4 text-[17px] leading-relaxed outline-none focus:border-accent"
        />
        {error && <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-[15px] text-ink-2">{error}</p>}
        {/* Кнопка сразу под полем: открытая клавиатура её не закрывает. */}
        <Button className="mt-3" disabled={busy != null || text.trim().length < 2} onClick={() => parse(text)}>
          {busy === "parse" ? "Разбираю…" : "Разобрать"}
        </Button>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="max-w-full rounded-2xl border border-line bg-surface px-3.5 py-1.5 text-left text-[13px] text-ink-2"
            >
              {ex}
            </button>
          ))}
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
          Если у каждой позиции указан вес, разбор проходит без ИИ. Иначе текст уходит в Gemini, который называет продукты и
          граммы; калории всегда считаются по справочнику.
        </p>
      </div>
    );
  }

  const weighRow = weighing ? rows.find((r) => r.key === weighing) ?? null : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow className="min-w-0">
          {rows.length} {plural(rows.length, ["позиция", "позиции", "позиций"])} · {source === "ai" ? "разобрал ИИ" : "без ИИ"}
        </Eyebrow>
        <button type="button" className="shrink-0 text-[15px] font-semibold text-accent" onClick={() => setRows(null)}>
          Изменить текст
        </button>
      </div>

      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => {
          const f = food(r);
          const n = f && okGrams(r.grams) ? scale(f.nutrientsPer100g, r.grams) : null;
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
                    {r.confidence < 0.6 && !r.gramsSet && r.grams != null && " · вес примерный"}
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
                          onClick={() => chooseFood(r, c)}
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

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <GramsPill row={r} onClick={() => setWeighing(r.key)} />
                    {n && (
                      <span className="tabular min-w-0 text-[14px] text-ink-2">
                        {formatInt(n.kcal ?? 0)} ккал · Б {fmt(n.protein)} · Ж {fmt(n.fat)} · У {fmt(n.carbs)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {(unmatched.length > 0 || noGrams.length > 0) && (
        <p className="mt-3 text-[14px] leading-snug text-ink-3">
          {unmatched.length > 0 &&
            `${unmatched.length} ${plural(unmatched.length, ["позиция", "позиции", "позиций"])} без продукта в дневник не попадёт — найдите вручную или уберите. `}
          {noGrams.length > 0 &&
            `${noGrams.length} ${plural(noGrams.length, ["позиция", "позиции", "позиций"])} без граммов — укажите вес или уберите.`}
        </p>
      )}

      {meal && (
        <div className="mt-6">
          <MealPicker
            meals={meals}
            plan={plan}
            showTimes={showTimes}
            value={meal.choice}
            onChange={(choice) => setMeal({ ...meal, choice, touched: true })}
            defaultNewTime={meal.newTime}
          />
        </div>
      )}

      {error && <p className="mt-4 rounded-2xl bg-surface px-4 py-3 text-[15px] text-warn">{error}</p>}

      <p className="tabular mt-6 text-[17px] font-bold text-ink">
        Итого {formatInt(totals.kcal ?? 0)} <span className="font-normal text-ink-2">ккал</span>
        <span className="ml-2 text-[15px] font-normal text-ink-2">
          Б {fmt(totals.protein)} · Ж {fmt(totals.fat)} · У {fmt(totals.carbs)}
        </span>
      </p>
      <Button className="mt-4" disabled={!canSave} onClick={save}>
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

      {weighRow && (
        <RowGramsSheet
          key={weighRow.key}
          title={food(weighRow)?.nameRu ?? weighRow.name}
          subtitle={food(weighRow)?.brand ?? undefined}
          per100g={food(weighRow)?.nutrientsPer100g ?? null}
          portion={portionOf(weighRow, food(weighRow))}
          initialGrams={initialGramsOf(weighRow, food(weighRow))}
          onSubmit={(g) => {
            update(weighRow.key, { grams: g, gramsSet: true });
            setWeighing(null);
          }}
          onClose={() => setWeighing(null)}
        />
      )}
    </div>
  );
}

/** Быстрая кнопка листа граммов: «2 шт (110 г)» для штук, иначе порция продукта. */
function portionOf(r: Row, f: FoodResult | null): { grams: number; label: string } | null {
  if (!f?.defaultPortionG) return null;
  const byPieces = piecesGrams(r, f);
  if (byPieces && okGrams(byPieces) && r.pieces !== 1) {
    return { grams: round1(byPieces), label: `${formatGrams(r.pieces!)} шт (${formatGrams(byPieces)} г)` };
  }
  return { grams: f.defaultPortionG, label: f.portionLabel ?? `порция ${formatGrams(f.defaultPortionG)} г` };
}

/** С чего начать лист граммов: указанный вес, иначе штуки по порции, порция, 100 г. */
function initialGramsOf(r: Row, f: FoodResult | null): number {
  if (okGrams(r.grams)) return r.grams;
  const byPieces = piecesGrams(r, f);
  return round1(okGrams(byPieces) ? byPieces : (f?.defaultPortionG ?? 100));
}

/** «180 г» — нажать и поправить; вес не понят — акцентное «указать граммы». */
function GramsPill({ row, onClick }: { row: Row; onClick: () => void }) {
  const ok = okGrams(row.grams);
  return (
    <button
      type="button"
      aria-label={ok ? `Граммы: ${formatGrams(row.grams!)} г, изменить` : `Указать граммы: ${row.name}`}
      onClick={onClick}
      className={`tabular inline-flex max-w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[15px] font-bold ${
        ok ? "border-line bg-surface text-ink" : "border-accent bg-accent/10 text-accent"
      }`}
    >
      <span className="truncate">
        {ok ? `${formatGrams(row.grams!)} г` : row.pieces ? `${formatGrams(row.pieces)} шт · указать граммы` : "указать граммы"}
      </span>
      <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
