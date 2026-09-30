"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { FoodResult } from "@/db/foods";
import { addHref } from "@/lib/diary-view";
import { type DayMeal, defaultMealChoice, type MealChoice, mealChoiceBody, newMealTime } from "@/lib/meal-choice";
import { notifyChanged } from "@/lib/native";
import { postEntry } from "@/lib/offline";
import { BarcodeScanner } from "@/ui/BarcodeScanner";
import { OwnFoodSheet } from "@/ui/OwnFoodSheet";
import { PortionSheet } from "@/ui/PortionSheet";
import { useKeyboardInset } from "@/ui/useKeyboardInset";

/** Сканер → поиск кода → лист порции; нет в OFF — «Свой продукт». */
type Scan =
  | { step: "camera" }
  | { step: "looking"; code: string }
  | { step: "failed"; code: string }
  | { step: "own"; code: string }
  | { step: "portion"; food: FoodResult };

/** Граммы по умолчанию — до 0,1 г: дробная порция (12,5 г) совпадает со своей кнопкой. */
const round1 = (g: number) => Math.round(g * 10) / 10;

function portionOf(f: FoodResult) {
  return f.defaultPortionG ? { grams: f.defaultPortionG, label: f.portionLabel ?? `порция ${f.defaultPortionG} г` } : null;
}

/**
 * Строка ввода над панелью вкладок: «творог 180, кофе» → разбор текста на
 * экране «Добавить»; штрихкод — прямо здесь, без перехода; пустое поле —
 * «+» открывает «Добавить». Пока открыта клавиатура, строка стоит прямо над
 * ней (панель вкладок в это время спрятана).
 */
export function QuickAdd({
  date,
  isToday,
  meals,
  plan,
  order,
  showTimes,
}: {
  date: string;
  isToday: boolean;
  /** Приёмы дня по порядку — кнопки выбора в листе порции (toDayMeals). */
  meals: DayMeal[];
  /** Приёмы своего списка из Профиля, которые предлагаются (без скрытых). */
  plan: string[];
  /** Весь свой список, со скрытыми: куда встанет новый приём. */
  order?: string[];
  showTimes: boolean;
}) {
  const router = useRouter();
  const keyboard = useKeyboardInset();
  const [text, setText] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Номер поиска кода: закрыли сообщение или сканируют снова — старый ответ не открывает лист. */
  const seq = useRef(0);
  const query = text.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!query) return;
    input.current?.blur();
    router.push(addHref(date, { text: query }));
  }

  /** Код → свой справочник или Open Food Facts; нет товара — свой продукт. */
  const lookup = useCallback(async (code: string) => {
    const my = ++seq.current;
    setScan({ step: "looking", code });
    const res = await fetch(`/api/foods/barcode/${code}`).catch(() => null);
    const food = res?.ok ? ((await res.json().catch(() => null)) as FoodResult | null) : null;
    if (my !== seq.current) return;
    if (food) setScan({ step: "portion", food });
    else setScan({ step: res?.status === 404 ? "own" : "failed", code });
  }, []);

  function close() {
    seq.current++;
    setScan(null);
  }

  async function add(grams: number, choice: MealChoice) {
    if (scan?.step !== "portion") return;
    const { food } = scan;
    const result = await postEntry({ foodId: food.id, grams, date, ...mealChoiceBody(choice) }, food.nameRu);
    if (result === "queued") {
      // Без сети клиентский переход не загрузится — открываем день из кэша service worker.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- офлайн: нужна полная загрузка из кэша SW
      window.location.assign(`/?d=${date}`);
      return;
    }
    setScan(null);
    notifyChanged();
    router.refresh();
  }

  const note =
    scan?.step === "looking"
      ? `Ищу товар ${scan.code}…`
      : scan?.step === "failed"
        ? "Open Food Facts не отвечает или нет сети — попробуйте ещё раз."
        : null;

  return (
    <>
      {/* Лента уходит под строку ввода с затуханием, а не просвечивает между ней и вкладками. */}
      {!keyboard && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-[calc(var(--tabbar-space)+72px)] bg-linear-to-t from-bg from-65% to-bg/0"
        />
      )}
      <div
        data-quickadd
        className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--tabbar-space)+8px)] z-30"
        // Клавиатура iOS ложится поверх страницы — строка встаёт прямо над ней.
        style={keyboard ? { bottom: keyboard + 8 } : undefined}
      >
        <div className="pointer-events-auto mx-auto max-w-xl">
          {note && (
            <div role="status" className="mb-2 flex items-center gap-3 rounded-2xl bg-ink px-4 py-2.5 text-[15px] text-white shadow-lg">
              <span className="min-w-0 flex-1 leading-snug">{note}</span>
              {scan?.step === "failed" && (
                <button type="button" onClick={() => lookup(scan.code)} className="shrink-0 py-1 font-semibold text-white">
                  Повторить
                </button>
              )}
              <button type="button" aria-label="Закрыть" onClick={close} className="-mr-1 shrink-0 px-1 py-1 text-white/70">
                ✕
              </button>
            </div>
          )}

          <form
            onSubmit={submit}
            className="flex items-center gap-1 rounded-[18px] border border-line bg-surface py-1.5 pr-1.5 pl-4 shadow-[0_6px_24px_rgba(17,18,43,0.08)]"
          >
            <input
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Что съели"
              placeholder="Что съели? «творог 180, кофе»"
              enterKeyHint="send"
              autoComplete="off"
              maxLength={1000} // как у поля «Текст» на экране «Добавить»
              className="h-11 min-w-0 flex-1 truncate bg-transparent text-[17px] text-ink outline-none placeholder:text-[15px] placeholder:text-ink-3"
            />
            <button
              type="button"
              aria-label="Сканировать штрихкод"
              onClick={() => {
                input.current?.blur();
                // Поиск прошлого кода ещё идёт — его ответ не должен закрыть сканер своим листом.
                seq.current++;
                setScan({ step: "camera" });
              }}
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2"
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
              </svg>
            </button>
            {query ? (
              <button
                type="submit"
                aria-label="Разобрать"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-white active:bg-accent-press"
              >
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
            ) : (
              <Link
                href={addHref(date)}
                aria-label="Добавить еду"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-white active:bg-accent-press"
              >
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </Link>
            )}
          </form>
        </div>
      </div>

      {scan?.step === "camera" && <BarcodeScanner onCode={lookup} onClose={close} />}

      {scan?.step === "own" && (
        <OwnFoodSheet
          initialBarcode={scan.code}
          note={`Товара ${scan.code} нет в Open Food Facts или у него нет КБЖУ. Перепишите их с упаковки — в следующий раз товар найдётся сканером.`}
          onSaved={(food) => setScan({ step: "portion", food })}
          onClose={close}
        />
      )}

      {scan?.step === "portion" && (
        <PortionSheet
          key={scan.food.id}
          title={scan.food.nameRu}
          subtitle={scan.food.brand ?? undefined}
          per100g={scan.food.nutrientsPer100g}
          initialGrams={round1(scan.food.defaultPortionG ?? 100)}
          portion={portionOf(scan.food)}
          meals={meals}
          plan={plan}
          order={order}
          showTimes={showTimes}
          // Лист читает приём один раз при открытии; правило то же, что на экране «Добавить».
          initialMeal={defaultMealChoice({ meals, plan, isToday })}
          defaultNewTime={newMealTime(isToday)}
          submitLabel="Добавить"
          onSubmit={add}
          onClose={close}
        />
      )}
    </>
  );
}
