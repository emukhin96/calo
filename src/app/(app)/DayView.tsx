import Link from "next/link";
import type { DayMealView } from "@/db/entries";
import type { Norms } from "@/domain/norms";
import { planNames } from "@/domain/meals";
import type { NutrientVector } from "@/domain/nutrients";
import { addHref, kcalStatus, remaining, weekStrip } from "@/lib/diary-view";
import { toDayMeals } from "@/lib/meal-choice";
import { Eyebrow } from "@/ui/components";
import { formatInt } from "@/ui/format";
import { HealthBanner } from "@/ui/HealthBanner";
import { TimeZoneSync } from "@/ui/TimeZoneSync";
import { AddPasskeyBanner } from "./AddPasskeyBanner";
import { DayTimeline } from "./DayTimeline";
import { QuickAdd } from "./QuickAdd";
import { fullDate, WeekStrip } from "./WeekStrip";

/**
 * Экран дня «Лента» по уже загруженным данным (page.tsx): полоса недели,
 * сводка, приёмы пищи по порядку дня, строка ввода над панелью вкладок.
 */
export function DayView({
  tz,
  date,
  today,
  norms,
  totals,
  meals,
  plan,
  showTimes,
  weekKcal,
}: {
  tz: string;
  date: string;
  today: string;
  norms: Norms;
  totals: NutrientVector;
  /** Приёмы дня по порядку с записями — loadDay().meals. */
  meals: DayMealView[];
  /** Свой список приёмов из Профиля: куда встаёт новый приём, кнопки пустого дня. */
  plan: string[];
  /** Показ времени приёмов включён в Профиле. */
  showTimes: boolean;
  /** Калории по дням недели date — только дни с записями (lib/week-strip). */
  weekKcal: Record<string, number>;
}) {
  const isToday = date === today;
  // Кнопки выбора приёма в листах порции: «Перекус · 2», с показом времени — «Обед 13:05».
  const choices = toDayMeals(meals, showTimes);

  return (
    // Снизу — место под строку ввода и панель вкладок: последний приём не прячется под ними.
    <main className="mx-auto max-w-xl px-6 pt-4 pb-[calc(var(--tabbar-space)+104px)]">
      <TimeZoneSync serverTz={tz} />

      <WeekStrip {...weekStrip(date, today, weekKcal, norms.kcalRange)} />
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Eyebrow className="min-w-0 !text-[14px]">{fullDate(date)}</Eyebrow>
        {!isToday && (
          <Link href={`/?d=${today}`} className="text-[15px] font-semibold text-accent">
            Сегодня
          </Link>
        )}
      </div>

      <Summary date={date} totals={totals} norms={norms} />

      <AddPasskeyBanner />
      <HealthBanner />

      {meals.length > 0 ? (
        <DayTimeline date={date} tz={tz} meals={meals} choices={choices} plan={plan} showTimes={showTimes} />
      ) : (
        <EmptyDay date={date} plan={plan} />
      )}

      <QuickAdd date={date} isToday={isToday} meals={choices} plan={plan} showTimes={showTimes} />
    </main>
  );
}

const MACROS = [
  { key: "protein", short: "Б", label: "Белки", color: "var(--color-protein)" },
  { key: "fat", short: "Ж", label: "Жиры", color: "var(--color-fat)" },
  { key: "carbs", short: "У", label: "Углеводы", color: "var(--color-carbs)" },
] as const;

/** Сводка дня: съедено из нормы, полоса, три чипа БЖУ — они ведут к нутриентам дня. */
function Summary({ date, totals, norms }: { date: string; totals: NutrientVector; norms: Norms }) {
  const kcal = totals.kcal ?? 0;
  const over = kcalStatus(kcal, norms.kcalRange) === "above";

  return (
    <section aria-label="Итоги дня" className="mt-4">
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="tabular font-display text-[36px] leading-[1.15] font-extrabold tracking-[-0.02em] text-ink">
          {formatInt(kcal)}
        </span>
        <span className="text-[14px] text-ink-2">
          из {formatInt(norms.kcal)} · {remaining(kcal, norms.kcal, norms.kcalRange)}
        </span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (kcal / norms.kcal) * 100)}%`, background: over ? "var(--color-warn)" : "var(--color-accent)" }}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {MACROS.map((m) => {
          const value = totals[m.key] ?? 0;
          const norm = norms.nutrients[m.key]?.value ?? 0;
          return (
            <Link
              key={m.key}
              href={`/nutrients?d=${date}`}
              aria-label={`${m.label} ${formatInt(value)} из ${formatInt(norm)} г — все нутриенты дня`}
              className="min-w-0 rounded-2xl bg-surface px-2.5 pt-2 pb-2.5 max-[360px]:px-2"
            >
              <span className="tabular block truncate text-[14px] text-ink-2 max-[360px]:text-[13px]">
                <b className="font-bold text-ink">{m.short}</b> {formatInt(value)}/{formatInt(norm)}
              </span>
              <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${norm > 0 ? Math.min(100, (value / norm) * 100) : 0}%`, background: m.color }}
                />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Пустой день: подсказка и быстрые «+ Завтрак» … — по своему списку приёмов из Профиля. */
function EmptyDay({ date, plan }: { date: string; plan: string[] }) {
  return (
    <section className="mt-7 rounded-2xl bg-surface px-5 py-5">
      <p className="text-[16px] leading-snug text-ink-2">Пока пусто. Напишите внизу, что съели, или отсканируйте штрихкод.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {planNames(plan).map((p) => (
          <Link
            key={p}
            href={addHref(date, { meal: p })}
            className="max-w-full truncate rounded-full border border-line bg-bg px-3.5 py-2 text-[15px] font-semibold text-accent"
          >
            + {p}
          </Link>
        ))}
      </div>
    </section>
  );
}
