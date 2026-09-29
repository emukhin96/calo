"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Entry } from "@/db/entries";
import type { Meal } from "@/domain/day";
import { NUTRIENT_KEYS, type NutrientVector, sum } from "@/domain/nutrients";
import { formatInt } from "@/ui/format";
import { health, notifyChanged } from "@/lib/native";
import { PortionSheet } from "@/ui/PortionSheet";

type MealGroup = { meal: Meal; title: string; entries: Entry[] };

/** Значения на 100 г из снимка записи — чтобы лист правки пересчитывал граммы. */
function per100g(e: Entry): NutrientVector {
  const out: NutrientVector = {};
  for (const k of NUTRIENT_KEYS) {
    const v = e.nutrients[k];
    if (v != null && e.grams > 0) out[k] = (v * 100) / e.grams;
  }
  return out;
}

/** Приёмы пищи дня; нажатие на запись — правка граммов/приёма или удаление. */
export function EntryList({ date, meals }: { date: string; meals: MealGroup[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Entry | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save(grams: number, meal: Meal) {
    const res = await fetch(`/api/entries/${editing!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grams, meal }),
    });
    if (!res.ok) throw new Error("save failed");
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryIds, name }),
    });
    if (!res.ok) {
      window.alert("Не получилось сохранить блюдо");
      return;
    }
    setEditing(null);
    setSaved(name);
    setTimeout(() => setSaved(null), 3000);
  }

  async function remove() {
    const res = await fetch(`/api/entries/${editing!.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error("delete failed");
    void health.deleteEntry(editing!.id); // из «Здоровья» — сразу, не дожидаясь синхронизации
    setEditing(null);
    notifyChanged();
    router.refresh();
  }

  return (
    <>
      <div className="mt-8 space-y-6">
        {meals.map(({ meal, title, entries }) => {
          const kcal = sum(entries.map((e) => e.nutrients)).kcal ?? 0;
          return (
            <section key={meal}>
              <div className="flex items-baseline justify-between border-b border-line pb-2">
                <h2 className="text-[17px] font-bold text-ink">{title}</h2>
                {entries.length > 0 ? (
                  <span className="tabular text-[15px] text-ink-2">{formatInt(kcal)} ккал</span>
                ) : (
                  <Link href={`/add?d=${date}&meal=${meal}`} className="text-[15px] font-semibold text-accent">
                    + добавить
                  </Link>
                )}
              </div>
              <ul>
                {entries.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => setEditing(e)} className="flex w-full items-baseline gap-3 py-2.5 text-left">
                      <span className="min-w-0 flex-1 text-[15px] text-ink">
                        {e.title}
                        <span className="text-ink-3"> · {formatInt(e.grams)} г</span>
                      </span>
                      <span className="tabular shrink-0 text-[15px] text-ink-2">{formatInt(e.nutrients.kcal ?? 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {entries.length > 0 && (
                <div className="flex gap-5 text-[14px] font-semibold">
                  <Link href={`/add?d=${date}&meal=${meal}`} className="text-accent">
                    + ещё
                  </Link>
                  {entries.filter((e) => e.foodId).length >= 2 && (
                    <button
                      type="button"
                      onClick={() => saveAsDish(entries.map((e) => e.id), `Мой ${title.toLowerCase()}`)}
                      className="text-ink-3"
                    >
                      сохранить как блюдо
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {editing && (
        <PortionSheet
          title={editing.title}
          per100g={per100g(editing)}
          initialGrams={editing.grams}
          initialMeal={editing.meal}
          submitLabel="Сохранить"
          onSubmit={save}
          onDelete={remove}
          extra={{ label: "Сохранить как блюдо", run: () => saveAsDish([editing.id], editing.title) }}
          onClose={() => setEditing(null)}
        />
      )}

      {saved && (
        <div className="fixed inset-x-6 bottom-[calc(100px+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-2xl bg-ink px-5 py-3 text-center text-[15px] text-white shadow-lg">
          «{saved}» — в «Моих блюдах»
        </div>
      )}
    </>
  );
}
