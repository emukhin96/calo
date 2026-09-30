"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MEAL_NAME_MAX, mealKey, planNames } from "@/domain/meals";
import {
  type DayMeal,
  type MealChoice,
  type NewMealChoice,
  newMealChoice,
  newMealIndex,
  newMealName,
  typicalMealTime,
} from "@/lib/meal-choice";

export type { DayMeal, MealChoice } from "@/lib/meal-choice";

/**
 * «Приём пищи»: кнопки приёмов дня по порядку («Завтрак», «Перекус · 2»; с
 * показом времени — «Обед 13:05») и «+ новый» — название из своего списка
 * приёмов (Профиль) или своё. Новый приём встаёт на место по этому списку —
 * в строке заголовка подсказка, куда именно. Поле времени — только если показ
 * времени включён в Профиле. Логика выбора по умолчанию — lib/meal-choice.ts.
 * defaultNewTime — что показать в поле времени нового приёма, пока его не
 * меняли (сегодня — «сейчас»); без него — типичное время выбранного названия.
 */
export function MealPicker({
  meals,
  plan,
  showTimes,
  value,
  onChange,
  defaultNewTime,
}: {
  meals: DayMeal[];
  plan: string[];
  showTimes: boolean;
  value: MealChoice;
  onChange: (c: MealChoice) => void;
  defaultNewTime?: string;
}) {
  const names = planNames(plan);
  const inPlan = (name: string) => names.some((p) => mealKey(p) === mealKey(name));
  const isNew = value.kind === "new";
  const newName = value.kind === "new" ? value.name : "";
  const newTime = value.kind === "new" ? value.time : null;

  /** Своё название: включили «свой…» (поле может быть и пустым). */
  const [custom, setCustom] = useState(false);
  /** Своё название помним: переключились на «Обед» и обратно в «свой…» — набранное не пропало. */
  const [customName, setCustomName] = useState(() => (isNew && !inPlan(newName) ? newName : ""));
  /** Последний новый приём: ушли в начатый приём и вернулись в «+ новый» — выбор на месте. */
  const [draft, setDraft] = useState<NewMealChoice | null>(() => (value.kind === "new" ? value : null));
  const nameInput = useRef<HTMLInputElement>(null);

  // Название не из списка (из ссылки, по часу) — тоже своё: оно в поле ввода.
  const own = isNew && (custom || (newName.trim() !== "" && !inPlan(newName)));
  const showEditor = isNew || meals.length === 0;

  function emitNew(c: NewMealChoice) {
    setDraft(c);
    onChange(c);
  }

  function startNew() {
    if (isNew) return; // уже новый — набранное не сбрасываем
    if (draft) {
      // again — по приёмам дня сейчас: день могли обновить, пока лист открыт.
      emitNew(newMealChoice(meals, draft.name, draft.time));
      return;
    }
    const name = newMealName({ meals, plan });
    if (!inPlan(name)) setCustomName(name);
    emitNew(newMealChoice(meals, name));
  }

  function choosePlanName(name: string) {
    if (own && newName.trim()) setCustomName(newName);
    setCustom(false);
    // Время, выставленное вручную, остаётся; невыставленное следует за названием.
    emitNew(newMealChoice(meals, name, newTime));
  }

  function startCustom() {
    // Фокус — в том же нажатии, иначе iOS не покажет клавиатуру; поле для этого
    // должно появиться сразу.
    flushSync(() => {
      setCustom(true);
      if (!own) emitNew(newMealChoice(meals, customName, newTime));
    });
    nameInput.current?.focus();
  }

  // Поле времени нового приёма: выставленное, иначе «сейчас» / типичное для названия.
  const shownTime = newTime ?? defaultNewTime ?? typicalMealTime(newName);
  const at = isNew && meals.length > 0 && newName.trim() ? newMealIndex(meals, newName, plan) : null;
  const hint = at == null ? null : at === 0 ? "встанет первым" : `встанет после «${meals[at - 1].label}»`;

  return (
    <div>
      {/* Куда встанет новый приём — в строке заголовка: лист не становится выше. */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="shrink-0 text-[15px] font-semibold text-ink">Приём пищи</p>
        {hint && <p className="min-w-0 truncate text-[13px] text-ink-3">{hint}</p>}
      </div>

      {meals.length > 0 && (
        <div role="group" aria-label="Приёмы дня" className="mt-2 flex flex-wrap gap-2">
          {meals.map((m) => {
            const on = value.kind === "existing" && value.mealId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ kind: "existing", mealId: m.id, name: m.name })}
                className={`max-w-full truncate rounded-full border px-3.5 py-1.5 text-[14px] font-semibold ${
                  on ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2"
                }`}
              >
                {m.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={isNew}
            onClick={startNew}
            className={`rounded-full border border-dashed border-accent/60 px-3.5 py-1.5 text-[14px] font-semibold text-accent ${
              isNew ? "bg-accent/10" : ""
            }`}
          >
            + новый
          </button>
        </div>
      )}

      {showEditor && (
        <div className={meals.length > 0 ? "mt-3" : "mt-2"}>
          {/* Кнопки растягиваются на всю строку, как сегменты; отступы малые, чтобы
              четыре приёма и «свой…» уместились в строку на 375 px. Длинное название
              переносится на новую строку и обрезается, а не распирает лист. */}
          <div role="group" aria-label="Название нового приёма" className="flex flex-wrap gap-1 rounded-2xl bg-line/60 p-1">
            {names.map((p) => {
              const on = isNew && !own && mealKey(newName) === mealKey(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => choosePlanName(p)}
                  className={`max-w-full min-w-0 flex-auto truncate rounded-xl px-1.5 py-2 text-[14px] font-semibold max-[360px]:text-[13px] ${
                    on ? "bg-surface text-ink shadow-sm" : "text-ink-2"
                  }`}
                >
                  {p}
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

          {(own || showTimes) && (
            <div className="mt-2 flex items-center gap-2">
              {own ? (
                <input
                  ref={nameInput}
                  aria-label="Своё название приёма"
                  value={newName}
                  maxLength={MEAL_NAME_MAX}
                  placeholder="Название приёма"
                  autoComplete="off"
                  enterKeyHint="done"
                  onChange={(e) => {
                    setCustomName(e.target.value);
                    setCustom(true); // стёрли название из ссылки — поле не пропадает
                    emitNew(newMealChoice(meals, e.target.value, newTime));
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
                  onChange={(e) =>
                    // Стёрли время (кнопка «Сбросить» на iOS) — время решит сервер.
                    emitNew(newMealChoice(meals, newName, e.target.value || null))
                  }
                  className="tabular h-11 w-[6.75rem] shrink-0 rounded-xl border border-line bg-surface px-2 text-center text-[17px] text-ink outline-none focus:border-accent"
                />
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
