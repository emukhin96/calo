import Link from "next/link";
import { db } from "@/db";
import { getMealSettings } from "@/db/profile";
import { dayTitle, todayIn } from "@/domain/day";
import { loadDay } from "@/lib/diary";
import { diaryDateOf } from "@/lib/diary-date";
import { shortTime, toDayMeals } from "@/lib/meal-choice";
import { requireSession } from "@/lib/session";
import { userTimeZone } from "@/lib/tz";
import { Eyebrow } from "@/ui/components";
import { addTabOf, initialTextOf, preferredKey, preferredMealOf, preferredMealTitle } from "./add-flow";
import { FoodSearch } from "./FoodSearch";

/**
 * «Добавить»: «Продукт» — поиск по справочнику → порция → запись; «Текст» — разбор
 * описания через Gemini (этап 6); «Мои блюда». Фото — этап 7.
 * /add?d=2026-09-29 — в день (будущий — сегодня, как на главном экране: записи
 * в будущий день не бывает); &meal=<id приёма дня> — в этот приём, &meal=Обед —
 * в приём с этим названием (или новый; старое &meal=lunch тоже); &text=… — из
 * строки ввода дневника, сразу разбор; &tab=food|text|recipes. Прежний &t= не нужен.
 */
export default async function AddPage({ searchParams }: PageProps<"/add">) {
  const session = await requireSession();
  const tz = await userTimeZone(session.user.id);
  const sp = await searchParams;
  const today = todayIn(tz);
  const d = diaryDateOf(sp.d, today);
  const preferred = preferredMealOf(sp.meal);
  const text = initialTextOf(sp.text);
  const tab = addTabOf(sp.tab, text);
  // Приёмы дня по порядку — выбор «в какой приём» в листе порции и после разбора
  // текста; свой список приёмов и показ времени — из Профиля.
  const [{ meals }, { plan, showTimes }] = await Promise.all([loadDay(session.user.id, d, tz), getMealSettings(db, session.user.id)]);
  const title = preferredMealTitle(meals, preferred, showTimes);

  return (
    <main className="mx-auto max-w-xl px-6 pt-8 pb-[calc(64px+env(safe-area-inset-bottom))]">
      {/* День переносится на вторую строку, а не обрезается: «понедельник, 28 сентября»
          не влезает в строку даже на 390 px, а дата — главное, куда пишем. */}
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow className="min-w-0">Добавить · {dayTitle(d, tz).toLowerCase()}</Eyebrow>
        <Link href={`/?d=${d}`} className="shrink-0 text-[16px] font-semibold text-accent">
          Готово
        </Link>
      </div>
      <h1 className={`mt-2 font-display text-[28px] leading-tight font-extrabold ${title ? "" : "mb-6"}`}>Что съели?</h1>
      {/* Приём из ссылки «добавить в этот приём» — подзаголовком: своё название бывает
          длинным и крупным шрифтом заняло бы полэкрана. Выбор можно поменять в листе порции. */}
      {title && (
        <p className="mt-1 mb-6 text-[17px] font-semibold break-words text-ink-2">
          {title.label}
          {title.time && <span className="tabular font-normal text-ink-3"> · {shortTime(title.time)}</span>}
        </p>
      )}
      {/* Другой день или приём — состояние вкладок не переносим. Текст и вкладку в ключ не
          берём: «Текст» убирает ?text= из адреса, и router.refresh (возврат в приложение)
          не должен сбрасывать разобранный список. */}
      <FoodSearch
        key={`${d}|${preferredKey(preferred)}`}
        date={d}
        meals={toDayMeals(meals, showTimes)}
        plan={plan}
        showTimes={showTimes}
        isToday={d === today}
        preferred={preferred}
        initialTab={tab}
        initialText={text}
      />
    </main>
  );
}
