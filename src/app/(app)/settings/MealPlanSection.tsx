"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MEAL_NAME_MAX, MEAL_PLAN_MAX, normalizeMealName } from "@/domain/meals";
import { insertIndex, mealSuggestions, moveItem } from "./meal-plan";

type MealSettings = { plan: string[]; showTimes: boolean };
/** Строка списка: id — только для React (названия могут повторяться). */
type Item = { id: number; name: string };
type Status = "idle" | "saving" | "saved" | "error";

const STATUS_TEXT: Record<Status, string> = { idle: "", saving: "Сохраняю…", saved: "Сохранено", error: "Не сохранилось" };

/**
 * Профиль → «Приёмы пищи»: свой список приёмов по порядку (в этом порядке
 * новые приёмы встают в дневнике) и показ времени приёмов. Каждая правка
 * сохраняется сразу (PUT /api/profile/meals), как нормы и вес на этой
 * странице; быстрые нажатия подряд уходят одним запросом за другим, последний
 * — с итоговым списком. Не сохранилось — список возвращается к сохранённому.
 */
export function MealPlanSection({ plan, showTimes: initialShowTimes }: MealSettings) {
  const router = useRouter();
  const switchId = useId();
  const nextId = useRef(plan.length);
  const [items, setItems] = useState<Item[]>(() => plan.map((name, id) => ({ id, name })));
  const [showTimes, setShowTimes] = useState(initialShowTimes);
  const [status, setStatus] = useState<Status>("idle");
  /** Переименование: какой приём и что набрано. */
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  /** Только что добавленный или передвинутый — подсвечен, чтобы глаз его не потерял. */
  const [flash, setFlash] = useState<number | null>(null);

  const listRef = useRef<HTMLOListElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const cancelRename = useRef(false);
  const confirmed = useRef<MealSettings>({ plan, showTimes: initialShowTimes });
  const pending = useRef<MealSettings | null>(null);
  const saving = useRef(false);

  const full = items.length >= MEAL_PLAN_MAX;
  const suggestions = mealSuggestions(items.map((i) => i.name));
  const draftName = normalizeMealName(draft);

  function commit(nextItems: Item[], nextShowTimes = showTimes) {
    setItems(nextItems);
    setShowTimes(nextShowTimes);
    pending.current = { plan: nextItems.map((i) => i.name), showTimes: nextShowTimes };
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
      confirmed.current = await res.json().catch(() => body);
    }
    saving.current = false;
    if (ok) {
      setStatus("saved");
      router.refresh();
      return;
    }
    pending.current = null;
    setRenaming(null);
    setItems(confirmed.current.plan.map((name) => ({ id: nextId.current++, name })));
    setShowTimes(confirmed.current.showTimes);
    setStatus("error");
  }

  function highlight(id: number) {
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1200);
  }

  function move(index: number, dir: -1 | 1) {
    const id = items[index].id;
    flushSync(() => commit(moveItem(items, index, dir)));
    highlight(id);
    // Фокус едет вместе с приёмом (клавиатура, VoiceOver); у края — на соседнюю стрелку.
    const btn = (d: string) => listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${id}:${d}"]`);
    const same = btn(dir < 0 ? "up" : "down");
    (same && !same.disabled ? same : btn(dir < 0 ? "down" : "up"))?.focus();
  }

  function remove(index: number) {
    if (items.length <= 1) return;
    commit(items.filter((_, i) => i !== index));
  }

  function add(raw: string) {
    const name = normalizeMealName(raw);
    if (!name || full) return;
    const at = insertIndex(items.map((i) => i.name), name);
    const item = { id: nextId.current++, name };
    commit([...items.slice(0, at), item, ...items.slice(at)]);
    setDraft("");
    highlight(item.id);
    if (items.length + 1 >= MEAL_PLAN_MAX) setAdding(false);
  }

  function startRename(it: Item) {
    // Другой приём ещё переименовывается: на iOS нажатие кнопки не снимает
    // фокус с поля, и оно пропало бы без onBlur — набранное название
    // потерялось бы. Снимаем фокус сами: finishRename сохранит его.
    renameInput.current?.blur();
    // Фокус — в том же нажатии, иначе iOS не покажет клавиатуру.
    flushSync(() => setRenaming({ id: it.id, value: it.name }));
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
    const current = items.find((i) => i.id === renaming.id);
    // Пустое название — отмена: приём без названия не бывает.
    if (cancelled || !name || !current || name === current.name) return;
    commit(items.map((i) => (i.id === renaming.id ? { ...i, name } : i)));
  }

  return (
    <>
      <div className="mt-9 mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[19px] font-bold text-ink">Приёмы пищи</h2>
        <span aria-live="polite" className={`text-[13px] ${status === "error" ? "text-warn" : "text-ink-3"}`}>
          {STATUS_TEXT[status]}
        </span>
      </div>
      <p className="mb-3 text-[14px] text-ink-3">
        В этом порядке приёмы встают в дневнике; в самом дне их можно передвинуть. Нажмите на название, чтобы его
        изменить.
      </p>

      <ol ref={listRef} aria-label="Приёмы пищи по порядку" className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
        {items.map((it, i) => (
          <li
            key={it.id}
            className={`flex items-center gap-0.5 py-1 pr-1 pl-4 transition-colors duration-500 ${
              flash === it.id ? "bg-accent/10" : ""
            }`}
          >
            {renaming?.id === it.id ? (
              // Поле — на всю строку; стрелки вернутся, когда название сохранится.
              <>
                <input
                  ref={renameInput}
                  aria-label={`Название приёма: ${it.name}`}
                  value={renaming.value}
                  maxLength={MEAL_NAME_MAX}
                  autoComplete="off"
                  enterKeyHint="done"
                  onChange={(e) => setRenaming({ id: it.id, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      cancelRename.current = true;
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={finishRename}
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
                  aria-label={`Переименовать: ${it.name}`}
                  onClick={() => startRename(it)}
                  className="min-h-11 min-w-0 flex-1 py-2 text-left text-[16px] font-semibold text-ink wrap-anywhere"
                >
                  {it.name}
                </button>
                <IconButton label={`Выше: ${it.name}`} data-move={`${it.id}:up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <path d="m6 14 6-6 6 6" />
                </IconButton>
                <IconButton
                  label={`Ниже: ${it.name}`}
                  data-move={`${it.id}:down`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <path d="m6 10 6 6 6-6" />
                </IconButton>
                <IconButton label={`Убрать: ${it.name}`} disabled={items.length <= 1} onClick={() => remove(i)}>
                  <path d="M7 7l10 10M17 7 7 17" />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ol>

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
              maxLength={MEAL_NAME_MAX}
              placeholder="Название"
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => setDraft(e.target.value)}
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
        onClick={() => commit(items, !showTimes)}
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

/** Круглая кнопка-иконка 40×40: «Выше», «Ниже», «Убрать». */
function IconButton({
  label,
  disabled,
  onClick,
  children,
  ...rest
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  "data-move"?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      {...rest}
      className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink-2 active:bg-line/60 disabled:opacity-25"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}
