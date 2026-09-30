"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { clampMealName, MEAL_NAME_MAX, mealKey, planNames } from "@/domain/meals";
import {
  chipChoice,
  chosenChip,
  type DayMeal,
  type MealChoice,
  mealChips,
  newMealChoice,
  newMealIndex,
  typicalMealTime,
} from "@/lib/meal-choice";

export type { DayMeal, MealChoice } from "@/lib/meal-choice";

/**
 * «Приём пищи»: стандартный набор из своего списка в Профиле (без скрытых, по
 * его порядку) — «Завтрак · Обед · Ужин · Перекус», затем приёмы дня не из
 * списка («Кофе») и «свой…» — своё название. Название, которое в дне уже есть,
 * добавляет в этот приём (точка у кнопки); нет — новый приём, в строке
 * заголовка подсказка, куда он встанет. «Перекус» — в любое время дня: в
 * перекус, если он в дне последний, иначе новый в конце дня. Приём, выбранный
 * заранее («+» у приёма, правка записи), которого кнопка названия не выберет,
 * — своей кнопкой («Перекус · 1»). Поле времени нового приёма — только если
 * показ времени включён в Профиле. Логика — lib/meal-choice.ts.
 * plan — названия, которые предлагаются (без скрытых); order — весь свой
 * список со скрытыми, по нему подсказка «встанет после…» (без него — plan).
 * defaultNewTime — что показать в поле времени нового приёма, пока его не
 * меняли (сегодня — «сейчас»); без него — типичное время выбранного названия.
 */
export function MealPicker({
  meals,
  plan,
  order,
  showTimes,
  value,
  onChange,
  defaultNewTime,
}: {
  meals: DayMeal[];
  plan: string[];
  order?: string[];
  showTimes: boolean;
  value: MealChoice;
  onChange: (c: MealChoice) => void;
  defaultNewTime?: string;
}) {
  const names = planNames(plan);
  const inPlan = (name: string) => names.some((p) => mealKey(p) === mealKey(name));
  const isNew = value.kind === "new";
  const newName = value.kind === "new" ? value.name : "";

  /** Приём, выбранный при открытии: его кнопка остаётся, даже когда выбрали другой. */
  const [initial] = useState(() => (value.kind === "existing" ? value.mealId : null));
  /** Своё название: включили «свой…» (поле может быть и пустым). */
  const [custom, setCustom] = useState(false);
  /** Своё название помним: переключились на «Обед» и обратно в «свой…» — набранное не пропало. */
  const [customName, setCustomName] = useState(() => (isNew && !inPlan(newName) ? newName : ""));
  /** Время нового приёма, выставленное вручную: остаётся при смене названия и после начатого приёма. */
  const [time, setTime] = useState<string | null>(() => (value.kind === "new" ? value.time : null));
  const nameInput = useRef<HTMLInputElement>(null);

  const chips = mealChips(meals, plan, [initial, value.kind === "existing" ? value.mealId : null]);
  // Название не из списка (из ссылки, по часу) — тоже своё: оно в поле ввода.
  const own = isNew && (custom || (newName.trim() !== "" && !inPlan(newName)));
  const chosen = own ? null : chosenChip(chips, value);

  function choose(chip: (typeof chips)[number]) {
    if (own && newName.trim()) setCustomName(newName);
    setCustom(false);
    onChange(chipChoice(chip, meals, time));
  }

  function startCustom() {
    // Фокус — в том же нажатии, иначе iOS не покажет клавиатуру; поле для этого
    // должно появиться сразу.
    flushSync(() => {
      setCustom(true);
      if (!own) onChange(newMealChoice(meals, customName, time));
    });
    nameInput.current?.focus();
  }

  // Поле времени нового приёма: выставленное, иначе «сейчас» / типичное для названия.
  const shownTime = (value.kind === "new" ? value.time : null) ?? defaultNewTime ?? typicalMealTime(newName);
  const at = isNew && meals.length > 0 && newName.trim() ? newMealIndex(meals, newName, order ?? plan) : null;
  const hint = at == null ? null : at === 0 ? "встанет первым" : `встанет после «${meals[at - 1].label}»`;

  return (
    <div>
      {/* Куда встанет новый приём — в строке заголовка: лист не становится выше. */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="shrink-0 text-[15px] font-semibold text-ink">Приём пищи</p>
        {hint && <p className="min-w-0 truncate text-[13px] text-ink-3">{hint}</p>}
      </div>

      {/* Кнопки растягиваются на всю строку, как сегменты; отступы малые, чтобы
          четыре приёма и «свой…» уместились в строку на 375 px. Длинное название
          переносится на новую строку и обрезается, а не распирает лист. */}
      <div role="group" aria-label="Приём пищи" className="mt-2 flex flex-wrap gap-1 rounded-2xl bg-line/60 p-1">
        {chips.map((c) => {
          const on = chosen === c.key;
          // Приём с этим названием в дне уже есть — запись встанет в него.
          const started = c.kind === "meal" || c.join != null;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => choose(c)}
              className={`relative max-w-full min-w-0 flex-auto truncate rounded-xl px-1.5 py-2 text-[14px] font-semibold max-[360px]:text-[13px] ${
                on ? "bg-surface text-ink shadow-sm" : "text-ink-2"
              }`}
            >
              {c.label}
              {/* Точка под названием — место в строке не занимает. */}
              {started && (
                <>
                  <span aria-hidden className="absolute bottom-[3px] left-1/2 size-1 -translate-x-1/2 rounded-full bg-accent/70" />
                  <span className="sr-only">, уже есть в дне</span>
                </>
              )}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={own}
          onClick={startCustom}
          className={`max-w-full min-w-0 flex-auto truncate rounded-xl px-1.5 py-2 text-[14px] font-semibold max-[360px]:text-[13px] ${
            own ? "bg-surface text-ink shadow-sm" : "text-ink-3"
          }`}
        >
          свой…
        </button>
      </div>

      {(own || (isNew && showTimes)) && (
        <div className="mt-2 flex items-center gap-2">
          {own ? (
            <input
              ref={nameInput}
              aria-label="Своё название приёма"
              value={newName}
              maxLength={MEAL_NAME_MAX * 2}
              placeholder="Название приёма"
              autoComplete="off"
              enterKeyHint="done"
              onChange={(e) => {
                const name = clampMealName(e.target.value);
                setCustomName(name);
                setCustom(true); // стёрли название из ссылки — поле не пропадает
                onChange(newMealChoice(meals, name, value.kind === "new" ? value.time : time));
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[17px] text-ink outline-none placeholder:text-ink-3/60 focus:border-accent"
            />
          ) : (
            <span className="min-w-0 flex-1 text-[15px] text-ink-2">Время приёма</span>
          )}
          {showTimes && (
            <input
              type="time"
              aria-label="Время приёма"
              value={shownTime}
              onChange={(e) => {
                // Стёрли время (кнопка «Сбросить» на iOS) — время решит сервер.
                const t = e.target.value || null;
                setTime(t);
                onChange(newMealChoice(meals, newName, t));
              }}
              className="tabular h-11 w-[6.75rem] shrink-0 rounded-xl border border-line bg-surface px-2 text-center text-[17px] text-ink outline-none focus:border-accent"
            />
          )}
        </div>
      )}
    </div>
  );
}
