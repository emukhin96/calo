import Link from "next/link";
import { addDays, dayTitle, isIsoDate, MEAL_RU, MEALS, todayIn } from "@/domain/day";
import { loadDay } from "@/lib/diary";
import { requireSession } from "@/lib/session";
import { userTimeZone } from "@/lib/tz";
import { BigNumber, Eyebrow } from "@/ui/components";
import { formatInt } from "@/ui/format";
import { TimeZoneSync } from "@/ui/TimeZoneSync";
import { AddPasskeyBanner } from "./AddPasskeyBanner";
import { EntryList } from "./EntryList";

/** Дневник за день: /?d=2026-09-29 (по умолчанию — сегодня в часовом поясе пользователя). */
export default async function DayPage({ searchParams }: PageProps<"/">) {
  const session = await requireSession();
  const tz = await userTimeZone();
  const sp = await searchParams;
  const today = todayIn(tz);
  const date = typeof sp.d === "string" && isIsoDate(sp.d) ? sp.d : today;
  const { entries, totals } = await loadDay(session.user.id, date, tz);
  const title = dayTitle(date, tz);
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ru-RU", { ...o, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  // «Сегодня / Вчера» крупно, иначе день недели; под ним дата.
  const heading = /^(Сегодня|Вчера|Завтра)$/.test(title) ? title : fmt({ weekday: "long" });
  const subheading = fmt({ day: "numeric", month: "long" });

  return (
    <main className="mx-auto max-w-xl px-6 pt-6 pb-32">
      <TimeZoneSync serverTz={tz} />

      <nav className="flex items-center justify-between">
        <DayLink date={addDays(date, -1)} label="Предыдущий день">‹</DayLink>
        <div className="text-center">
          <p className="text-[17px] font-bold text-ink first-letter:uppercase">{heading}</p>
          <Eyebrow className="!text-[13px]">{subheading}</Eyebrow>
        </div>
        {date < today ? <DayLink date={addDays(date, 1)} label="Следующий день">›</DayLink> : <span className="size-10" />}
      </nav>

      <div className="mt-5">
        <BigNumber value={totals.kcal ?? 0} caption="ккал" />
      </div>
      <Eyebrow className="mt-2">норма появится после настройки профиля</Eyebrow>

      <AddPasskeyBanner />

      <dl className="mt-6 grid grid-cols-3 gap-3">
        {[
          ["Белки", totals.protein, "var(--color-protein)"],
          ["Жиры", totals.fat, "var(--color-fat)"],
          ["Углеводы", totals.carbs, "var(--color-carbs)"],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-2xl bg-surface px-4 py-3">
            <dt className="flex items-center gap-1.5 text-[13px] text-ink-3">
              <span className="size-2 shrink-0 rounded-full" style={{ background: color as string }} />
              {label}
            </dt>
            <dd className="tabular mt-1 text-[22px] font-bold text-ink">
              {formatInt((value as number | undefined) ?? 0)} <span className="text-[14px] font-normal text-ink-2">г</span>
            </dd>
          </div>
        ))}
      </dl>

      <EntryList
        date={date}
        meals={MEALS.map((m) => ({
          meal: m,
          title: MEAL_RU[m],
          entries: entries.filter((e) => e.meal === m),
        }))}
      />

      <Link href="/week" className="mt-10 block text-[16px] font-semibold text-accent">
        Разбор прошлой недели (демо) →
      </Link>

      <Link
        href={`/add?d=${date}`}
        aria-label="Добавить еду"
        className="fixed right-6 bottom-[calc(24px+env(safe-area-inset-bottom))] flex size-16 items-center justify-center rounded-full bg-accent text-[34px] leading-none text-white shadow-lg shadow-accent/30"
      >
        +
      </Link>
    </main>
  );
}

function DayLink({ date, label, children }: { date: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={`/?d=${date}`}
      aria-label={label}
      className="flex size-10 items-center justify-center rounded-full bg-surface text-[24px] leading-none text-ink-2"
    >
      {children}
    </Link>
  );
}
