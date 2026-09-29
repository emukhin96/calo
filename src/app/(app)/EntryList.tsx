"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Entry } from "@/db/entries";
import type { Meal } from "@/domain/day";
import { NUTRIENT_KEYS, type NutrientVector, sum } from "@/domain/nutrients";
import { formatInt } from "@/ui/format";
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

  async function save(grams: number, meal: Meal) {
    const res = await fetch(`/api/entries/${editing!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grams, meal }),
    });
    if (!res.ok) throw new Error("save failed");
    setEditing(null);
    router.refresh();
  }

  async function remove() {
    const res = await fetch(`/api/entries/${editing!.id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error("delete failed");
    setEditing(null);
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
                <Link href={`/add?d=${date}&meal=${meal}`} className="text-[14px] font-semibold text-accent">
                  + ещё
                </Link>
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
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
