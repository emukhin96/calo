"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { clampMealName, MEAL_NAME_MAX, MEAL_PLAN_MAX, type MealPlanItem, normalizeMealName } from "@/domain/meals";
import { arrangeById, moveId } from "@/lib/reorder";
import { DragCard, DragHandle, SortableList, SrMoveButtons, useSortableRow } from "@/ui/Sortable";
import { addMealItem, canRemove, mealSuggestions, renameItem, toggleHidden } from "./meal-plan";

type MealSettings = { items: MealPlanItem[]; showTimes: boolean };
/** Строка списка: id — для React и перетаскивания (названия могут повторяться). */
type Row = MealPlanItem & { id: string };
type Status = "idle" | "saving" | "saved" | "error";

const STATUS_TEXT: Record<Status, string> = { idle: "", saving: "Сохраняю…", saved: "Сохранено", error: "Не сохранилось" };

/**
 * Профиль → «Приёмы пищи»: свой список приёмов по порядку — они предлагаются
 * при добавлении еды, и в этом же порядке новые приёмы встают в дневнике
 * («Перекус» — в конец дня). Порядок — перетаскиванием за «⋮⋮», название —
 * нажатием, глаз — предлагать приём или скрыть (скрытый всё равно задаёт
 * порядок), × — убрать; «+ Добавить приём»; показ времени приёмов. Каждая
 * правка сохраняется сразу (PUT /api/profile/meals { items, showTimes }), как
 * нормы и вес на этой странице; быстрые правки подряд уходят одним запросом за
 * другим, последний — с итоговым списком. Не сохранилось — список
 * возвращается к сохранённому.
 */
export function MealPlanSection({ items: initialItems, showTimes: initialShowTimes }: MealSettings) {
  const router = useRouter();
  const switchId = useId();
  const nextId = useRef(initialItems.length);
  const [rows, setRows] = useState<Row[]>(() => initialItems.map((i, n) => ({ name: i.name, hidden: i.hidden, id: `m${n}` })));
  const [showTimes, setShowTimes] = useState(initialShowTimes);
  const [status, setStatus] = useState<Status>("idle");
  /** Переименование: какой приём и что набрано. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  /** Только что добавленный или передвинутый — подсвечен, чтобы глаз его не потерял. */
  const [flash, setFlash] = useState<string | null>(null);

  const renameInput = useRef<HTMLInputElement>(null);
  const cancelRename = useRef(false);
  const confirmed = useRef<MealSettings>({ items: initialItems, showTimes: initialShowTimes });
  const pending = useRef<MealSettings | null>(null);
  const saving = useRef(false);

  const ids = rows.map((r) => r.id);
  const full = rows.length >= MEAL_PLAN_MAX;
  const suggestions = mealSuggestions(rows.map((r) => r.name));
  const draftName = normalizeMealName(draft);

  function commit(nextRows: Row[], nextShowTimes = showTimes) {
    setRows(nextRows);
    setShowTimes(nextShowTimes);
    pending.current = { items: nextRows.map((r) => ({ name: r.name, hidden: r.hidden })), showTimes: nextShowTimes };
    void flush();
  }

  async function flush() {
    if (saving.current) return; // уйдёт следом за текущим запросом
    saving.current = true;
    setStatus("saving");
    let ok = true;
    while (pending.current) {
      const body = pending.current;
      pending.current = null;
      const res = await fetch("/api/profile/meals", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res?.ok) {
        ok = false;
        break;
      }
      const saved = (await res.json().catch(() => null)) as Partial<MealSettings> | null;
      confirmed.current = { items: saved?.items ?? body.items, showTimes: saved?.showTimes ?? body.showTimes };
    }
    saving.current = false;
    if (ok) {
      setStatus("saved");
      router.refresh();
      return;
    }
    pending.current = null;
    setRenaming(null);
    setRows(confirmed.current.items.map((i) => ({ name: i.name, hidden: i.hidden, id: `m${nextId.current++}` })));
    setShowTimes(confirmed.current.showTimes);
    setStatus("error");
  }

  function highlight(id: string) {
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1200);
  }

  function reorder(nextIds: string[], moved: string) {
    commit(arrangeById(rows, nextIds));
    highlight(moved);
  }

  function hide(index: number) {
    const next = toggleHidden(rows, index);
    if (next) commit(next);
  }

  function remove(index: number) {
    if (!canRemove(rows, index)) return;
    commit(rows.filter((_, i) => i !== index));
  }

  function add(raw: string) {
    const name = normalizeMealName(raw);
    if (!name) return;
    const row: Row = { name, hidden: false, id: `m${nextId.current++}` };
    const next = addMealItem(rows, name, () => row);
    const isNew = next.includes(row);
    if (isNew && full) return;
    commit(next);
    setDraft("");
    // Подсвечен новый приём или скрытый, который снова предлагается.
    const lit = isNew ? row : next.find((r, i) => r.hidden !== rows[i]?.hidden);
    if (lit) highlight(lit.id);
    if (isNew && rows.length + 1 >= MEAL_PLAN_MAX) setAdding(false);
  }

  function startRename(row: Row) {
    // Другой приём ещё переименовывается: на iOS нажатие кнопки не снимает
    // фокус с поля, и оно пропало бы без onBlur — набранное название
    // потерялось бы. Снимаем фокус сами: finishRename сохранит его.
    renameInput.current?.blur();
    // Фокус — в том же нажатии, иначе iOS не покажет клавиатуру.
    flushSync(() => setRenaming({ id: row.id, value: row.name }));
    const input = renameInput.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }

  function finishRename() {
    if (!renaming) return;
    const cancelled = cancelRename.current;
    cancelRename.current = false;
    setRenaming(null);
    const name = normalizeMealName(renaming.value);
    const index = rows.findIndex((r) => r.id === renaming.id);
    // Пустое название — отмена: приём без названия не бывает.
    if (cancelled || !name || index < 0 || name === rows[index].name) return;
    commit(renameItem(rows, index, name));
  }

  return (
    <>
      <div className="mt-9 mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[19px] font-bold text-ink">Приёмы пищи</h2>
        <span aria-live="polite" className={`text-[13px] ${status === "error" ? "text-warn" : "text-ink-3"}`}>
          {STATUS_TEXT[status]}
        </span>
      </div>
      <p className="mb-3 text-[14px] leading-snug text-ink-3">
        Предлагаются при добавлении еды; в этом порядке встают в дневнике, перекус — в конец дня. Перетащите
        за&nbsp;⋮⋮, чтобы переставить, нажмите на название, чтобы изменить.
      </p>

      <SortableList
        ids={ids}
        labelOf={(id) => rows.find((r) => r.id === id)?.name ?? ""}
        onReorder={reorder}
        overlay={(id) => {
          const row = rows.find((r) => r.id === id);
          return (
            row && (
              <DragCard className="min-h-[52px]">
                <span className={`min-w-0 flex-1 truncate text-[16px] font-semibold ${row.hidden ? "text-ink-3" : "text-ink"}`}>{row.name}</span>
                {row.hidden && <span className="shrink-0 text-[13px] text-ink-3">скрыт</span>}
              </DragCard>
            )
          );
        }}
      >
        <ol aria-label="Приёмы пищи по порядку" className="divide-y divide-line rounded-2xl bg-surface">
          {rows.map((row, i) => (
            <PlanRow
              key={row.id}
              row={row}
              index={i}
              count={rows.length}
              flash={flash === row.id}
              renaming={renaming?.id === row.id ? renaming.value : null}
              renameInput={renameInput}
              canHide={toggleHidden(rows, i) != null}
              canRemove={canRemove(rows, i)}
              onRename={() => startRename(row)}
              onRenameChange={(value) => setRenaming({ id: row.id, value })}
              onRenameDone={finishRename}
              onRenameCancel={() => {
                cancelRename.current = true;
                renameInput.current?.blur();
              }}
              onHide={() => hide(i)}
              onRemove={() => remove(i)}
              onMove={(dir) => reorder(moveId(ids, row.id, dir), row.id)}
            />
          ))}
        </ol>
      </SortableList>

      {full ? (
        <p className="mt-3 text-[14px] text-ink-3">Приёмов в списке — не больше {MEAL_PLAN_MAX}.</p>
      ) : !adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 min-h-11 rounded-full border border-dashed border-accent/60 px-4 text-[15px] font-semibold text-accent"
        >
          + Добавить приём
        </button>
      ) : (
        <div className="mt-3 rounded-2xl bg-surface p-3">
          {suggestions.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => add(s)}
                  className="min-h-10 rounded-full border border-line bg-bg px-3.5 text-[14px] font-semibold text-ink-2"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add(draft);
            }}
          >
            <input
              aria-label="Название нового приёма"
              value={draft}
              maxLength={MEAL_NAME_MAX * 2}
              placeholder="Название"
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setDraft(clampMealName(e.target.value))}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3.5 text-[17px] text-ink outline-none placeholder:text-ink-3/60 focus:border-accent"
            />
            <button
              type="submit"
              disabled={!draftName}
              className="h-11 shrink-0 rounded-xl bg-accent px-4 text-[15px] font-bold text-white disabled:opacity-40"
            >
              Добавить
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              // «Готово» с набранным названием — добавить его, а не молча выбросить.
              if (draftName) add(draft);
              setAdding(false);
              setDraft("");
            }}
            className="mt-2 min-h-10 text-[15px] font-semibold text-ink-3"
          >
            Готово
          </button>
        </div>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={showTimes}
        aria-labelledby={`${switchId}-label`}
        aria-describedby={`${switchId}-hint`}
        onClick={() => commit(rows, !showTimes)}
        className="mt-6 flex w-full items-center gap-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span id={`${switchId}-label`} className="block text-[16px] font-semibold text-ink">
            Показывать время приёмов пищи
          </span>
          <span id={`${switchId}-hint`} className="mt-0.5 block text-[14px] text-ink-3">
            Рядом с названием приёма в дневнике и при добавлении; время можно поменять.
          </span>
        </span>
        <span
          aria-hidden
          className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${showTimes ? "bg-accent" : "bg-line"}`}
        >
          <span
            className={`absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow transition-transform ${
              showTimes ? "translate-x-5" : ""
            }`}
          />
        </span>
      </button>
    </>
  );
}

/** Строка списка: ручка, название (нажатие — переименовать), глаз (предлагать / скрыт), ×. */
function PlanRow({
  row,
  index,
  count,
  flash,
  renaming,
  renameInput,
  canHide,
  canRemove,
  onRename,
  onRenameChange,
  onRenameDone,
  onRenameCancel,
  onHide,
  onRemove,
  onMove,
}: {
  row: Row;
  index: number;
  count: number;
  flash: boolean;
  /** Набранное название, пока приём переименовывают; иначе null. */
  renaming: string | null;
  renameInput: RefObject<HTMLInputElement | null>;
  canHide: boolean;
  canRemove: boolean;
  onRename: () => void;
  onRenameChange: (value: string) => void;
  onRenameDone: () => void;
  onRenameCancel: () => void;
  onHide: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, handleProps, style, dragging } = useSortableRow(row.id);
  const shown = !row.hidden;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-0.5 py-1 pr-1 pl-0.5 transition-colors duration-500 first:rounded-t-2xl last:rounded-b-2xl ${
        dragging ? "opacity-40" : flash ? "bg-accent/10" : ""
      }`}
    >
      <DragHandle
        setActivatorNodeRef={setActivatorNodeRef}
        handleProps={handleProps}
        label={`Переставить «${row.name}»`}
        className="h-11 w-9"
      />
      {renaming != null ? (
        // Поле — на всю строку; глаз и × вернутся, когда название сохранится.
        <>
          <input
            ref={renameInput}
            aria-label={`Название приёма: ${row.name}`}
            value={renaming}
            maxLength={MEAL_NAME_MAX * 2}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => onRenameChange(clampMealName(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") onRenameCancel();
            }}
            onBlur={onRenameDone}
            className="mr-1 h-11 min-w-0 flex-1 rounded-xl border border-accent bg-bg px-3 text-[17px] text-ink outline-none"
          />
          {/* На iOS нажатие кнопки не снимает фокус с поля — снимаем сами. */}
          <IconButton label="Сохранить название" onClick={() => renameInput.current?.blur()}>
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </IconButton>
        </>
      ) : (
        <>
          <button
            type="button"
            aria-label={`Переименовать: ${row.name}${shown ? "" : " (скрыт)"}`}
            onClick={onRename}
            className="flex min-h-11 min-w-0 flex-1 items-baseline gap-2 py-2 text-left"
          >
            <span className={`min-w-0 text-[16px] font-semibold wrap-anywhere ${shown ? "text-ink" : "text-ink-3"}`}>{row.name}</span>
            {!shown && <span className="shrink-0 text-[13px] text-ink-3">скрыт</span>}
          </button>
          <SrMoveButtons label={row.name} index={index} count={count} onMove={onMove} />
          <IconButton
            label={`Показывать «${row.name}» при добавлении`}
            role="switch"
            checked={shown}
            disabled={shown && !canHide}
            onClick={onHide}
          >
            {shown ? (
              <>
                <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
                <circle cx="12" cy="12" r="2.8" />
              </>
            ) : (
              <>
                <path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.4 9.4 0 0 0 5.4-1.6" />
                <path d="M4 4l16 16" />
              </>
            )}
          </IconButton>
          <IconButton label={`Убрать: ${row.name}`} disabled={!canRemove} onClick={onRemove}>
            <path d="M7 7l10 10M17 7 7 17" />
          </IconButton>
        </>
      )}
    </li>
  );
}

/** Круглая кнопка-иконка 40×40: «Показывать», «Убрать», «Сохранить название». */
function IconButton({
  label,
  role,
  checked,
  disabled,
  onClick,
  children,
}: {
  label: string;
  role?: "switch";
  checked?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? checked : undefined}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-10 shrink-0 items-center justify-center rounded-full active:bg-line/60 disabled:opacity-25 ${
        role && !checked ? "text-ink-3" : "text-ink-2"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}
