import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, dayTitle, isIsoDate, MEAL_RU, MEALS, todayIn } from "@/domain/day";
import { loadDay } from "@/lib/diary";
import { loadUser } from "@/lib/norms";
import { requireSession } from "@/lib/session";
import { userTimeZone } from "@/lib/tz";
import { BigNumber, Eyebrow, MacroBar } from "@/ui/components";
import { formatInt } from "@/ui/format";
import { TimeZoneSync } from "@/ui/TimeZoneSync";
import { AddPasskeyBanner } from "./AddPasskeyBanner";
import { EntryList } from "./EntryList";

/** Дневник за день: /?d=2026-09-29 (по умолчанию — сегодня в часовом поясе пользователя). */
export default async function DayPage({ searchParams }: PageProps<"/">) {
  const session = await requireSession();
  const { norms } = await loadUser(session.user.id);
  if (!norms) redirect("/onboarding");
  const tz = await userTimeZone(session.user.id);
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

      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>Calo</Eyebrow>
        <Link href="/settings" aria-label="Настройки" className="flex size-10 items-center justify-center rounded-full text-ink-3">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        </Link>
      </div>

      <nav className="flex items-center justify-between">
        <DayLink date={addDays(date, -1)} label="Предыдущий день">‹</DayLink>
        <div className="text-center">
          <p className="text-[17px] font-bold text-ink first-letter:uppercase">{heading}</p>
          <Eyebrow className="!text-[13px]">{subheading}</Eyebrow>
        </div>
        {date < today ? <DayLink date={addDays(date, 1)} label="Следующий день">›</DayLink> : <span className="size-10" />}
      </nav>

      <div className="mt-5">
        <BigNumber value={totals.kcal ?? 0} caption={<>ккал · норма {formatInt(norms.kcal)}</>} />
      </div>
      <Eyebrow className="mt-2">{remaining(totals.kcal ?? 0, norms.kcal, norms.kcalRange)}</Eyebrow>

      <AddPasskeyBanner />

      <div className="mt-6 space-y-4">
        <MacroBar label="Белки" value={totals.protein ?? 0} norm={norms.nutrients.protein!.value} color="var(--color-protein)" />
        <MacroBar label="Жиры" value={totals.fat ?? 0} norm={norms.nutrients.fat!.value} color="var(--color-fat)" />
        <MacroBar label="Углеводы" value={totals.carbs ?? 0} norm={norms.nutrients.carbs!.value} color="var(--color-carbs)" />
      </div>
      <Link href={`/nutrients?d=${date}`} className="mt-4 inline-block text-[15px] font-semibold text-accent">
        Витамины и минералы →
      </Link>

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

/** «осталось 620 ккал», «осталось 150 ккал · в коридоре нормы», «сверх нормы 380 ккал». */
function remaining(eaten: number, norm: number, [lo, hi]: [number, number]): string {
  if (eaten > hi) return `сверх нормы ${formatInt(eaten - norm)} ккал`;
  if (eaten > norm) return `в коридоре нормы · +${formatInt(eaten - norm)} ккал`;
  return `осталось ${formatInt(norm - eaten)} ккал${eaten >= lo ? " · в коридоре нормы" : ""}`;
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
