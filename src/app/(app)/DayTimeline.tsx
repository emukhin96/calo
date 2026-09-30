"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DayMealView, Entry } from "@/db/entries";
import { formatTime, mealLabels } from "@/domain/meals";
import { per100gOf } from "@/domain/nutrients";
import { addHref } from "@/lib/diary-view";
import { type DayMeal, type MealChoice, mealChoiceBody, shortTime } from "@/lib/meal-choice";
import { health, notifyChanged } from "@/lib/native";
import { arrangeById, moveId } from "@/lib/reorder";
import { formatInt } from "@/ui/format";
import { formatGrams } from "@/ui/grams";
import { PortionSheet } from "@/ui/PortionSheet";
import { DragCard, DragHandle, SortableList, SrMoveButtons, useSortableRow } from "@/ui/Sortable";
import { MealSheet } from "./MealSheet";

/** 180 → «180», 1500 → «1 500», 12,5 г — с десятыми, как в листе порции (не «13 г»). */
const gramsLabel = (g: number) => (Number.isInteger(Math.round(g * 10) / 10) ? formatInt(g) : formatGrams(g));

const JSON_HEADERS = { "content-type": "application/json" };

/** Порядок, который перетащили: ids — новый, base — порядок с сервера, пока тот его не подтвердил. */
type Optimistic = { ids: string[]; base: string };

/**
 * Лента дня: приёмы пищи в порядке дня — название (повтор с номером:
 * «Перекус · 2») и калории, «+» (добавить в этот приём), под ними записи.
 * Время приёма — колонкой слева, только если его показ включён в Профиле;
 * без него — простой список с тонкой линией между приёмами. Порядок приёмов
 * меняют перетаскиванием за ручку «⋮⋮» у названия (PUT /api/meals/order):
 * лента перестраивается сразу, не сохранилось — возвращается. Нажатие на
 * запись — граммы, перенос в другой приём, удаление; на приём — название
 * (и время), удалить.
 */
export function DayTimeline({
  date,
  tz,
  meals,
  choices,
  plan,
  order,
  showTimes,
}: {
  date: string;
  tz: string;
  /** Приёмы дня по порядку с записями — loadDay().meals. */
  meals: DayMealView[];
  /** Те же приёмы — кнопками выбора приёма в листе записи (toDayMeals). */
  choices: DayMeal[];
  /** Приёмы своего списка из Профиля, которые предлагаются (без скрытых). */
  plan: string[];
  /** Весь свой список, со скрытыми: куда встанет новый приём. */
  order?: string[];
  showTimes: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Entry | null>(null);
  /** Открытый лист приёма — по id: пока он открыт, лента за ним может обновиться. */
  const [mealOpen, setMealOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; warn?: boolean } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  /** Порядок уходит на сервер: запросы по одному, последний — с итоговым порядком. */
  const [saving, setSaving] = useState(false);
  const pending = useRef<string[] | null>(null);
  const inFlight = useRef(false);
  const serverKey = meals.map((m) => m.id).join(",");
  const serverKeyRef = useRef(serverKey);
  useEffect(() => {
    serverKeyRef.current = serverKey;
  });
  // Лента обновилась с сервера (порядок подтверждён или день поменялся) — свой порядок больше не нужен.
  if (optimistic && !saving && optimistic.base !== serverKey) setOptimistic(null);

  const shown = optimistic ? arrangeById(meals, optimistic.ids) : meals;
  const ids = shown.map((m) => m.id);
  // Подписи шапок — без времени: оно, если включено, стоит в своей колонке.
  const labels = mealLabels(shown);
  const labelOf = (id: string) => labels[ids.indexOf(id)] ?? "";
  const openIndex = mealOpen ? shown.findIndex((m) => m.id === mealOpen) : -1;
  const open = openIndex >= 0 ? shown[openIndex] : null;
  const sortable = shown.length > 1;

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  function flash(text: string, warn = false) {
    window.clearTimeout(toastTimer.current);
    setToast({ text, warn });
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }

  function reorder(next: string[]) {
    setOptimistic({ ids: next, base: serverKey });
    void saveOrder(next);
  }

  async function saveOrder(next: string[]) {
    pending.current = next;
    if (inFlight.current) return; // уйдёт следом за текущим запросом
    inFlight.current = true;
    setSaving(true);
    let confirmed: string[] | null = null;
    let failed: "conflict" | "network" | null = null;
    while (pending.current) {
      const body = pending.current;
      pending.current = null;
      const res = await fetch("/api/meals/order", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ date, ids: body }),
      }).catch(() => null);
      if (!res?.ok) {
        // 409 — приёмы дня уже другие (добавили или удалили в другом окне): порядок с сервера.
        failed = res?.status === 409 ? "conflict" : "network";
        pending.current = null;
        break;
      }
      const data = (await res.json().catch(() => null)) as { meals?: { id: string }[] } | null;
      confirmed = data?.meals?.map((m) => m.id) ?? body;
    }
    inFlight.current = false;
    if (failed) {
      setOptimistic(null);
      flash(failed === "conflict" ? "День изменился — порядок обновлён" : "Не получилось переставить — проверьте сеть", true);
    } else if (confirmed) {
      // Держим подтверждённый порядок, пока лента не обновится с сервера.
      setOptimistic({ ids: confirmed, base: serverKeyRef.current });
    }
    setSaving(false);
    router.refresh();
  }

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

  /** Одна запись или весь приём пищи → «Блюда». Название спрашиваем сразу. */
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
    flash(`«${name}» — в «Блюдах»`);
  }

  const rows = shown.map((m, i) => (
    <MealRow
      key={m.id}
      meal={m}
      label={labels[i]}
      index={i}
      count={shown.length}
      date={date}
      showTimes={showTimes}
      sortable={sortable}
      onOpen={() => setMealOpen(m.id)}
      onEdit={setEditing}
      onMove={(dir) => reorder(moveId(ids, m.id, dir))}
    />
  ));

  return (
    <>
      <SortableList
        ids={ids}
        labelOf={labelOf}
        onReorder={reorder}
        overlay={(id) => {
          const i = ids.indexOf(id);
          const m = shown[i];
          return (
            <DragCard>
              {showTimes && m.time && <span className="tabular shrink-0 text-[14px] font-semibold text-ink-3">{shortTime(m.time)}</span>}
              <span className="min-w-0 flex-1 truncate text-[17px] font-bold text-ink">{labels[i]}</span>
              <span className="tabular shrink-0 text-[15px] text-ink-2">{formatInt(m.totals.kcal ?? 0)} ккал</span>
            </DragCard>
          );
        }}
      >
        {/* Без времени — просто порядок дня: приёмы во всю ширину, между ними тонкая линия. */}
        <ol className={showTimes ? "mt-7" : "mt-6"}>{rows}</ol>
      </SortableList>

      {editing && (
        <PortionSheet
          key={editing.id}
          title={editing.title}
          // Значения на 100 г из снимка записи — лист пересчитывает граммы, как сервер при правке.
          per100g={per100gOf(editing.nutrients, editing.grams)}
          initialGrams={editing.grams}
          meals={choices}
          plan={plan}
          order={order}
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

      {toast && (
        <div
          role="status"
          className={`fixed inset-x-6 bottom-[calc(var(--tabbar-space)+88px)] z-40 mx-auto max-w-md rounded-2xl px-5 py-3 text-center text-[15px] text-white shadow-lg ${
            toast.warn ? "bg-warn" : "bg-ink"
          }`}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}

/**
 * Приём на ленте: шапка (ручка перетаскивания, название и ккал — лист приёма,
 * «+» — добавить в него) и записи. С показом времени — время колонкой слева и
 * линия ленты; ручка — узел на линии у начала приёма.
 */
function MealRow({
  meal: m,
  label,
  index,
  count,
  date,
  showTimes,
  sortable,
  onOpen,
  onEdit,
  onMove,
}: {
  meal: DayMealView;
  label: string;
  index: number;
  count: number;
  date: string;
  showTimes: boolean;
  /** В дне больше одного приёма — есть что переставлять. */
  sortable: boolean;
  onOpen: () => void;
  onEdit: (e: Entry) => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, handleProps, style, dragging } = useSortableRow(m.id);
  // Пока приём тянут, за пальцем едет его карточка, а он сам бледный — видно, куда встанет.
  const lifted = dragging ? "opacity-40" : "";
  const handleLabel = `Переставить «${label}»`;

  const header = (
    <div className="flex items-center gap-2">
      {sortable && !showTimes && (
        <DragHandle
          setActivatorNodeRef={setActivatorNodeRef}
          handleProps={handleProps}
          label={handleLabel}
          className="-my-2 -mr-1 -ml-1.5 h-10 w-7"
        />
      )}
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-baseline gap-3 py-0.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[17px] font-bold text-ink">{label}</span>
        <span className="tabular shrink-0 text-[15px] text-ink-2">{formatInt(m.totals.kcal ?? 0)} ккал</span>
      </button>
      {sortable && <SrMoveButtons label={label} index={index} count={count} onMove={onMove} />}
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
  );

  const entries = (
    // Без времени записи — вровень с названием, правее ручки.
    <ul className={`mt-0.5 ${sortable && !showTimes ? "pl-[1.625rem]" : ""}`}>
      {m.entries.map((e) => (
        <li key={e.id}>
          <button type="button" aria-haspopup="dialog" onClick={() => onEdit(e)} className="flex w-full items-baseline gap-3 py-2 text-left">
            <span className="min-w-0 flex-1 text-[15px] break-words text-ink">
              {e.title}
              <span className="text-ink-3"> · {gramsLabel(e.grams)} г</span>
            </span>
            <span className="tabular shrink-0 text-[15px] text-ink-2">{formatInt(e.nutrients.kcal ?? 0)}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  if (!showTimes) {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className={`${index > 0 ? "mt-2 border-t border-line pt-3.5" : ""} ${lifted}`}
      >
        {header}
        {entries}
      </li>
    );
  }

  return (
    <li ref={setNodeRef} style={style} className={`grid grid-cols-[3.5rem_minmax(0,1fr)] ${lifted}`}>
      {/* Время — часть шапки приёма: нажатие открывает тот же лист, где его и меняют.
          Вне порядка Tab — с клавиатуры лист открывает кнопка названия. */}
      <button type="button" tabIndex={-1} onClick={onOpen} className="tabular self-start pt-1 pr-4 pb-1 text-right text-[14px] font-semibold whitespace-nowrap text-ink-3">
        {m.time ? shortTime(m.time) : ""}
      </button>
      {/* Вертикальная линия ленты с узлом у начала приёма (он же ручка перетаскивания);
          у последнего — до конца его записей. */}
      <div className={`relative border-l border-line pl-4 ${index < count - 1 ? "pb-5" : ""}`}>
        {sortable ? (
          <DragHandle
            setActivatorNodeRef={setActivatorNodeRef}
            handleProps={handleProps}
            label={handleLabel}
            className="absolute -top-[5px] -left-[14px] h-9 w-7 rounded-full bg-bg"
          />
        ) : (
          <span aria-hidden className="absolute top-[9px] -left-[5px] size-[9px] rounded-full border-2 border-accent bg-bg" />
        )}
        {header}
        {entries}
      </div>
    </li>
  );
}
