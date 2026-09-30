"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clampMealName, MEAL_NAME_MAX, mealKey, normalizeMealName, parseTime, planNames } from "@/domain/meals";
import { countOf } from "@/domain/text";
import { addHref } from "@/lib/diary-view";
import { shortTime } from "@/lib/meal-choice";
import { health, notifyChanged } from "@/lib/native";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/components";
import { formatInt } from "@/ui/format";
import { useKeyboardInset } from "@/ui/useKeyboardInset";

const ENTRIES: [string, string, string] = ["запись", "записи", "записей"];
const JSON_HEADERS = { "content-type": "application/json" };
const minutes = (t: { hour: number; minute: number }) => t.hour * 60 + t.minute;

/**
 * Приём пищи на ленте дня. label — подпись с номером повтора («Перекус · 2»);
 * time — местное «HH:MM» первой записи.
 */
type SheetMeal = { id: string; name: string; label: string; time: string | null; kcal: number; entryCount: number };

/**
 * Лист приёма пищи: переименовать — название из своего списка приёмов или
 * своё — и, если показ времени включён в Профиле, поменять время всему
 * приёму; добавить в него; сохранить в «Блюда»; удалить. Порядок приёмов в
 * дне меняют перетаскиванием на самой ленте (DayTimeline), не здесь. Поле
 * названия без автофокуса: клавиатура — только когда в него нажали.
 */
export function MealSheet({
  date,
  meal,
  plan,
  showTimes,
  onSaveAsDish,
  onClose,
}: {
  date: string;
  meal: SheetMeal;
  /** Приёмы своего списка из Профиля (без скрытых) — готовые названия. */
  plan: string[];
  /** Показ времени приёмов включён в Профиле: время в шапке и поле времени. */
  showTimes: boolean;
  /** Есть, когда в приёме хотя бы два продукта из справочника. */
  onSaveAsDish?: () => Promise<void>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(meal.name);
  const [time, setTime] = useState(meal.time ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const keyboard = useKeyboardInset();

  const newName = normalizeMealName(name);
  const at = parseTime(time);
  const was = parseTime(meal.time);
  const renamed = newName != null && newName !== meal.name;
  // Стёрли время (кнопка «Сбросить» на iOS) — время приёма не меняем.
  const retimed = showTimes && at != null && (was == null || minutes(at) !== minutes(was));
  const changed = renamed || retimed;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!changed) return onClose();
    const res = await fetch(`/api/meals/${meal.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...(renamed ? { name: newName } : {}), ...(retimed ? { time } : {}) }),
    });
    if (!res.ok) throw new Error("meal update failed");
    onClose();
    notifyChanged();
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Удалить «${meal.label}» — ${countOf(meal.entryCount, ENTRIES)}?`)) return;
    const res = await fetch(`/api/meals/${meal.id}`, { method: "DELETE" });
    // 404 — приём уже удалён (с другого устройства): записи из «Здоровья» уберёт синхронизация.
    if (!res.ok && res.status !== 404) throw new Error("meal delete failed");
    const ids = res.ok ? ((await res.json()) as { deletedEntryIds: string[] }).deletedEntryIds : [];
    for (const id of ids) void health.deleteEntry(id); // из «Здоровья» — сразу, не дожидаясь синхронизации
    onClose();
    notifyChanged();
    router.refresh();
  }

  return (
    <BottomSheet label={`Приём пищи «${meal.label}»`} onClose={onClose}>
      {/* Шапка — вне прокрутки: пока открыта клавиатура, лист низкий и докручен
          до поля, а кнопка «Сохранить» здесь всё равно видна. */}
      <div className="flex shrink-0 items-start gap-3 px-6">
        <h2 className="min-w-0 flex-1 text-[19px] leading-snug font-bold break-words text-ink">
          {meal.label}
          {showTimes && meal.time && <span className="tabular font-normal text-ink-3"> · {shortTime(meal.time)}</span>}
        </h2>
        {/* Клавиатура закрывает низ листа — сохранить можно и отсюда. */}
        {keyboard > 0 && (
          <button
            type="button"
            disabled={busy || newName == null}
            onClick={() => run(save)}
            className="shrink-0 py-0.5 text-[16px] font-bold text-accent disabled:opacity-50"
          >
            {changed ? "Сохранить" : "Готово"}
          </button>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-6">
        <p className="tabular mt-0.5 text-[15px] text-ink-3">
          {countOf(meal.entryCount, ENTRIES)} · {formatInt(meal.kcal)} ккал
        </p>

        <p className="mt-5 text-[15px] font-semibold text-ink">{showTimes ? "Название и время" : "Название"}</p>
        {/* Кнопки растягиваются на всю строку, как сегменты; длинное название
            переносится на новую строку и обрезается, а не распирает лист. */}
        <div role="group" aria-label="Названия из вашего списка" className="mt-2 flex flex-wrap gap-1 rounded-2xl bg-line/60 p-1">
          {planNames(plan).map((p) => {
            const on = mealKey(name) === mealKey(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => setName(p)}
                className={`max-w-full min-w-0 flex-auto truncate rounded-xl px-1.5 py-2 text-[14px] font-semibold max-[360px]:text-[13px] ${
                  on ? "bg-surface text-ink shadow-sm" : "text-ink-2"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            aria-label="Название приёма"
            value={name}
            maxLength={MEAL_NAME_MAX * 2}
            placeholder="Своё название"
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => setName(clampMealName(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[17px] text-ink outline-none placeholder:text-ink-3/60 focus:border-accent"
          />
          {showTimes && (
            <input
              type="time"
              aria-label="Время приёма"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="tabular h-11 w-[6.75rem] shrink-0 rounded-xl border border-line bg-surface px-2 text-center text-[17px] text-ink outline-none focus:border-accent"
            />
          )}
        </div>
        {newName == null && <p className="mt-1.5 text-[13px] text-warn">Напишите название или выберите из списка</p>}
        {retimed && meal.entryCount > 1 && (
          <p className="mt-1.5 text-[13px] leading-snug text-ink-3">Все записи приёма встанут на {shortTime(time)}.</p>
        )}

        {error && <p className="mt-4 text-[15px] text-warn">Не получилось — проверьте сеть и попробуйте ещё раз</p>}
        <Button className="mt-5" disabled={busy || newName == null} onClick={() => run(save)}>
          {busy ? "Сохраняю…" : changed ? "Сохранить" : "Готово"}
        </Button>

        <Link href={addHref(date, { meal: meal.id })} className="mt-2 block w-full py-3 text-center text-[16px] font-semibold text-accent">
          + Добавить в этот приём
        </Link>
        {onSaveAsDish && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(onSaveAsDish)}
            className="w-full py-2 text-[15px] font-semibold text-accent disabled:opacity-50"
          >
            Сохранить как блюдо
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => run(remove)}
          className="w-full py-3 text-[16px] font-semibold text-warn disabled:opacity-50"
        >
          Удалить приём
        </button>
      </div>
    </BottomSheet>
  );
}
