"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import type { DayMealView, Entry } from "@/db/entries";
import { formatTime, mealLabels } from "@/domain/meals";
import { NUTRIENT_KEYS, type NutrientVector } from "@/domain/nutrients";
import { addHref } from "@/lib/diary-view";
import { type DayMeal, type MealChoice, mealChoiceBody, shortTime } from "@/lib/meal-choice";
import { health, notifyChanged } from "@/lib/native";
import { formatInt } from "@/ui/format";
import { formatGrams } from "@/ui/grams";
import { PortionSheet } from "@/ui/PortionSheet";
import { MealSheet } from "./MealSheet";

/** 180 → «180», 1500 → «1 500», 12,5 г — с десятыми, как в листе порции (не «13 г»). */
const gramsLabel = (g: number) => (Number.isInteger(Math.round(g * 10) / 10) ? formatInt(g) : formatGrams(g));

const JSON_HEADERS = { "content-type": "application/json" };

/** Значения на 100 г из снимка записи — чтобы лист правки пересчитывал граммы. */
function per100g(e: Entry): NutrientVector {
  const out: NutrientVector = {};
  for (const k of NUTRIENT_KEYS) {
    const v = e.nutrients[k];
    if (v != null && e.grams > 0) out[k] = (v * 100) / e.grams;
  }
  return out;
}

/**
 * Лента дня: приёмы пищи в порядке дня — название (повтор с номером:
 * «Перекус · 2») и калории, «+» (добавить в этот приём), под ними записи.
 * Время приёма — колонкой слева, только если его показ включён в Профиле;
 * без него — простой список с тонкой линией между приёмами. Нажатие на запись —
 * граммы, перенос в другой приём, удаление; на приём — название, порядок в дне
 * (и время), удалить.
 */
export function DayTimeline({
  date,
  tz,
  meals,
  choices,
  plan,
  showTimes,
}: {
  date: string;
  tz: string;
  /** Приёмы дня по порядку с записями — loadDay().meals. */
  meals: DayMealView[];
  /** Те же приёмы — кнопками выбора приёма в листе записи (toDayMeals). */
  choices: DayMeal[];
  /** Свой список приёмов из Профиля. */
  plan: string[];
  showTimes: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Entry | null>(null);
  /** Открытый лист приёма — по id: после «Выше» / «Ниже» он остаётся открытым над обновлённой лентой. */
  const [mealOpen, setMealOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Подписи шапок — без времени: оно, если включено, стоит в своей колонке.
  const labels = mealLabels(meals);
  const openIndex = mealOpen ? meals.findIndex((m) => m.id === mealOpen) : -1;
  const open = openIndex >= 0 ? meals[openIndex] : null;

  async function save(grams: number, choice: MealChoice) {
    const entry = editing!;
    // Приём не меняли — только граммы. Новый приём: время, выставленное в листе
    // (показ времени включён), сервер ставит ему; иначе время записи прежнее.
    const moved = !(choice.kind === "existing" && choice.mealId === entry.mealId);
    const res = await fetch(`/api/entries/${entry.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ grams, ...(moved ? mealChoiceBody(choice) : {}) }),
    });
    if (!res.ok) throw new Error("save failed");
    setEditing(null);
    notifyChanged();
    router.refresh();
  }

  async function remove() {
    const entry = editing!;
    const res = await fetch(`/api/entries/${entry.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error("delete failed");
    void health.deleteEntry(entry.id); // из «Здоровья» — сразу, не дожидаясь синхронизации
    setEditing(null);
    notifyChanged();
    router.refresh();
  }

  /** Одна запись или весь приём пищи → «Мои блюда». Название спрашиваем сразу. */
  async function saveAsDish(entryIds: string[], suggested: string) {
    const name = window.prompt("Название блюда", suggested)?.trim();
    if (!name) return;
    const res = await fetch("/api/recipes/from-entries", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ entryIds, name }),
    });
    if (!res.ok) {
      window.alert("Не получилось сохранить блюдо");
      return;
    }
    setEditing(null);
    setMealOpen(null);
    setSaved(name);
    setTimeout(() => setSaved(null), 3000);
  }

  function body(m: DayMealView, label: string): ReactNode {
    return (
      <>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setMealOpen(m.id)}
            className="flex min-w-0 flex-1 items-baseline gap-3 py-0.5 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-[17px] font-bold text-ink">{label}</span>
            <span className="tabular shrink-0 text-[15px] text-ink-2">{formatInt(m.totals.kcal ?? 0)} ккал</span>
          </button>
          <Link
            href={addHref(date, { meal: m.id })}
            aria-label={`Добавить в «${label}»`}
            className="-my-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </Link>
        </div>
        <ul className="mt-0.5">
          {m.entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setEditing(e)}
                className="flex w-full items-baseline gap-3 py-2 text-left"
              >
                <span className="min-w-0 flex-1 text-[15px] break-words text-ink">
                  {e.title}
                  <span className="text-ink-3"> · {gramsLabel(e.grams)} г</span>
                </span>
                <span className="tabular shrink-0 text-[15px] text-ink-2">{formatInt(e.nutrients.kcal ?? 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      {showTimes ? (
        <ol className="mt-7">
          {meals.map((m, i) => (
            <li key={m.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)]">
              {/* Время — часть шапки приёма: нажатие открывает тот же лист, где его и меняют.
                  Вне порядка Tab — с клавиатуры лист открывает кнопка названия. */}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setMealOpen(m.id)}
                className="tabular self-start pt-1 pr-3 pb-1 text-right text-[14px] font-semibold text-ink-3"
              >
                {m.time ? shortTime(m.time) : ""}
              </button>
              {/* Вертикальная линия ленты с кружком у начала приёма; у последнего — до конца его записей. */}
              <div className={`relative border-l border-line pl-4 ${i < meals.length - 1 ? "pb-5" : ""}`}>
                <span aria-hidden className="absolute top-[9px] -left-[5px] size-[9px] rounded-full border-2 border-accent bg-bg" />
                {body(m, labels[i])}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        // Без времени — просто порядок дня: приёмы во всю ширину, между ними тонкая линия.
        <ol className="mt-6">
          {meals.map((m, i) => (
            <li key={m.id} className={i > 0 ? "mt-2 border-t border-line pt-3.5" : ""}>
              {body(m, labels[i])}
            </li>
          ))}
        </ol>
      )}

      {editing && (
        <PortionSheet
          key={editing.id}
          title={editing.title}
          per100g={per100g(editing)}
          initialGrams={editing.grams}
          meals={choices}
          plan={plan}
          showTimes={showTimes}
          initialMeal={{ kind: "existing", mealId: editing.mealId, name: editing.mealName }}
          // Перенос в новый приём без выбранного времени его у записи не меняет — его и показываем в поле.
          defaultNewTime={formatTime(new Date(editing.eatenAt), tz)}
          submitLabel="Сохранить"
          onSubmit={save}
          onDelete={remove}
          extra={{ label: "Сохранить как блюдо", run: () => saveAsDish([editing.id], editing.title) }}
          onClose={() => setEditing(null)}
        />
      )}

      {open && (
        <MealSheet
          key={open.id}
          date={date}
          meal={{
            id: open.id,
            name: open.name,
            label: labels[openIndex],
            time: open.time,
            kcal: open.totals.kcal ?? 0,
            entryCount: open.entries.length,
          }}
          index={openIndex}
          count={meals.length}
          plan={plan}
          showTimes={showTimes}
          onSaveAsDish={
            open.entries.filter((e) => e.foodId).length >= 2
              ? () => saveAsDish(open.entries.map((e) => e.id), `Мой ${open.name.toLocaleLowerCase("ru")}`)
              : undefined
          }
          onClose={() => setMealOpen(null)}
        />
      )}

      {saved && (
        <div className="fixed inset-x-6 bottom-[calc(var(--tabbar-space)+88px)] z-40 mx-auto max-w-md rounded-2xl bg-ink px-5 py-3 text-center text-[15px] text-white shadow-lg">
          «{saved}» — в «Моих блюдах»
        </div>
      )}
    </>
  );
}
