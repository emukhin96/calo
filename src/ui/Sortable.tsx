"use client";

import {
  type Announcements,
  type CollisionDescriptor,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Чьё место займёт строка: та, в чью строку (по местам до перетаскивания)
 * попал центр карточки по вертикали; в щели между строками — ближайшая.
 * Не «ближайший центр» (closestCenter): карточка — одна шапка, а приём с
 * записями намного выше, и высокий приём под коротким менялся с ним местами,
 * едва его сдвинули с места.
 */
const cardCenterWithin: CollisionDetection = ({ collisionRect, droppableRects, droppableContainers }) => {
  const y = collisionRect.top + collisionRect.height / 2;
  const hits: CollisionDescriptor[] = [];
  for (const c of droppableContainers) {
    const r = droppableRects.get(c.id);
    if (!r) continue;
    const value = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    hits.push({ id: c.id, data: { droppableContainer: c, value } });
  }
  return hits.sort((a, b) => a.data.value - b.data.value);
};

/**
 * Клавиатура: стрелки вверх / вниз на ручке сразу ставят строку на соседнее место
 * (без «поднять — выбрать — отпустить»). Клавиатурный датчик dnd-kit сначала
 * прокручивает страницу к новому месту и на странице, которая прокручивается
 * всего на несколько пикселей, строку вниз так и не сдвигал.
 */
type Keyboard = { moveBy: (id: string, dir: -1 | 1) => void; handleRef: (id: string, el: HTMLElement | null) => void };
const KeyboardMove = createContext<Keyboard | null>(null);

/**
 * Перестановка списка перетаскиванием (@dnd-kit) — приёмы дня в дневнике и
 * свой список приёмов в Профиле. Тянут только за ручку (DragHandle): у неё
 * touch-action: none, остальная строка прокручивает страницу как обычно.
 * Палец и мышь (у края экрана страница прокручивается сама) и клавиатура:
 * фокус на ручке → стрелки вверх / вниз — на соседнее место (KeyboardMove).
 * За пальцем едет карточка строки (overlay, position: fixed — страницу не
 * удлиняет, поверх строки ввода и вкладок), а сама строка бледнеет и
 * показывает, куда встанет; соседи плавно расступаются.
 * Для VoiceOver на телефоне — скрытые кнопки «выше / ниже» (SrMoveButtons).
 */
export function SortableList({
  ids,
  labelOf,
  overlay,
  onReorder,
  children,
}: {
  ids: string[];
  /** Название строки для озвучки: «Обед». */
  labelOf: (id: string) => string;
  /** Карточка строки, которая едет за пальцем (DragCard). */
  overlay: (id: string) => ReactNode;
  /** Новый порядок после перетаскивания; moved — какую строку переставили. */
  onReorder: (ids: string[], moved: string) => void;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  // Свой id: иначе номера подсказок для диктора на сервере и в браузере расходятся (гидратация).
  const id = useId();
  const sensors = useSensors(
    // Нажатие без сдвига — не перетаскивание: ручка остаётся кнопкой для фокуса.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const name = (id: UniqueIdentifier) => `«${labelOf(String(id))}»`;
  const handles = useRef(new Map<string, HTMLElement>());
  // Стабильная: ref-колбэк ручки не пересоздаётся на каждый рендер списка.
  const handleRef = useCallback((row: string, el: HTMLElement | null) => {
    if (el) handles.current.set(row, el);
    else handles.current.delete(row);
  }, []);
  const keyboard = useMemo<Keyboard>(
    () => ({
      moveBy: (moved, dir) => {
        const from = ids.indexOf(moved);
        const to = from + dir;
        if (from < 0 || to < 0 || to >= ids.length) return;
        onReorder(arrayMove(ids, from, to), moved);
        setSaid(`«${labelOf(moved)}» — место ${to + 1} из ${ids.length}.`);
        // Строка переехала в DOM — фокус остаётся на её ручке.
        requestAnimationFrame(() => handles.current.get(moved)?.focus());
      },
      handleRef,
    }),
    [ids, labelOf, onReorder, handleRef],
  );
  const place = (id: UniqueIdentifier) => `место ${ids.indexOf(String(id)) + 1} из ${ids.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Взяли ${name(active.id)}, ${place(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} — ${place(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => `Отпустили ${name(active.id)}${over ? `, ${place(over.id)}` : ""}.`,
    onDragCancel: ({ active }) => `Отменено, ${name(active.id)} на прежнем месте.`,
  };

  function end({ active, over }: DragEndEvent) {
    setActive(null);
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to), String(active.id));
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={cardCenterWithin}
      modifiers={[restrictToVerticalAxis]}
      // Снизу экран закрывают строка ввода и вкладки: страница едет сама уже над
      // ними (четверть высоты экрана), а не только у самого края.
      autoScroll={{ threshold: { x: 0, y: 0.25 }, acceleration: 12 }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "Стрелки вверх и вниз — переставить на соседнее место.",
        },
      }}
      onDragStart={(e) => setActive(String(e.active.id))}
      onDragCancel={() => setActive(null)}
      onDragEnd={end}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <KeyboardMove.Provider value={keyboard}>{children}</KeyboardMove.Provider>
      </SortableContext>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      {/* Высота — по карточке, а не по строке: высокий приём с записями тянуть
          неудобно, а совпадения считаются по тому, что едет за пальцем. */}
      <DragOverlay modifiers={[restrictToVerticalAxis, restrictToWindowEdges]} style={{ height: "auto" }} zIndex={45}>
        {active != null && ids.includes(active) ? overlay(active) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** Атрибуты и обработчики ручки строки (DragHandle handleProps). */
export type SortableHandleProps = ReturnType<typeof useSortableRow>["handleProps"];

/**
 * Строка списка SortableList: setNodeRef и style — на саму строку (соседи
 * плавно расступаются; пока её тянут, dragging — строка бледная и показывает,
 * куда встанет), setActivatorNodeRef и handleProps — в DragHandle.
 */
export function useSortableRow(id: string) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    attributes: { roleDescription: "перестановка" },
  });
  const keyboard = useContext(KeyboardMove);
  const handleRef = keyboard?.handleRef;
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const activatorRef = useCallback(
    (el: HTMLElement | null) => {
      setActivatorNodeRef(el);
      handleRef?.(id, el);
    },
    [id, handleRef, setActivatorNodeRef],
  );
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const dir = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!dir || !keyboard) return;
    e.preventDefault(); // стрелка не прокручивает страницу
    keyboard.moveBy(id, dir);
  };
  return {
    setNodeRef,
    setActivatorNodeRef: activatorRef,
    handleProps: { ...attributes, ...listeners, onKeyDown },
    style,
    dragging: isDragging,
  };
}

/**
 * Ручка перетаскивания «⋮⋮». label — «Переставить «Обед»». Размер и место
 * задаёт className (зона нажатия — не меньше 28×40).
 */
export function DragHandle({
  setActivatorNodeRef,
  handleProps,
  label,
  className = "",
}: {
  setActivatorNodeRef: (el: HTMLElement | null) => void;
  handleProps: SortableHandleProps;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...handleProps}
      aria-label={label}
      className={`flex shrink-0 cursor-grab touch-none items-center justify-center text-ink-3 select-none [-webkit-touch-callout:none] active:cursor-grabbing ${className}`}
    >
      <GripIcon />
    </button>
  );
}

/**
 * Карточка строки, которая едет за пальцем: ручка и содержимое строки
 * (название, калории) на поднятой «плашке».
 */
export function DragCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex cursor-grabbing items-center gap-2 rounded-2xl bg-surface py-2 pr-4 pl-1.5 shadow-[0_12px_32px_4px_rgba(17,18,43,0.18)] ${className}`}
    >
      <span aria-hidden className="flex h-9 w-7 shrink-0 items-center justify-center text-accent">
        <GripIcon />
      </span>
      {children}
    </div>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

/**
 * «Выше» / «Ниже» для экранного диктора на телефоне: VoiceOver не умеет тянуть
 * ручку, а эти кнопки находит жестами. На экране их нет, и в порядке Tab их
 * нет — с клавиатуры переставляют ручкой.
 */
export function SrMoveButtons({
  label,
  index,
  count,
  onMove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <>
      {index > 0 && (
        <button type="button" tabIndex={-1} className="sr-only" onClick={() => onMove(-1)}>
          Переставить «{label}» выше
        </button>
      )}
      {index < count - 1 && (
        <button type="button" tabIndex={-1} className="sr-only" onClick={() => onMove(1)}>
          Переставить «{label}» ниже
        </button>
      )}
    </>
  );
}
