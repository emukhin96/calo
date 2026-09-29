import Link from "next/link";
import { redirect } from "next/navigation";
import { addDays, isIsoDate, todayIn, weekStart, weekTitle } from "@/domain/day";
import { requireSession } from "@/lib/session";
import { userTimeZone } from "@/lib/tz";
import { lastCompleteWeek, loadWeekReport } from "@/lib/week";
import { BigNumber, Eyebrow, MarkList, SectionTitle, Sheet } from "@/ui/components";
import { formatInt, plural } from "@/ui/format";
import { UnderstoodButton } from "./UnderstoodButton";
import { WeekChart } from "./WeekChart";

/** Недельный разбор — экран со скриншота. /week?w=2026-09-21 — другая неделя. */
export default async function WeekPage({ searchParams }: PageProps<"/week">) {
  const session = await requireSession();
  const tz = await userTimeZone(session.user.id);
  const sp = await searchParams;
  const current = weekStart(todayIn(tz));
  const latest = lastCompleteWeek(tz);
  const monday = typeof sp.w === "string" && isIsoDate(sp.w) && weekStart(sp.w) <= current ? weekStart(sp.w) : latest;
  const data = await loadWeekReport(session.user.id, monday, tz);
  if (!data) redirect("/onboarding");
  const r = data.report;
  const inProgress = monday === current;
  const label = inProgress ? "Эта неделя · идёт" : monday === latest ? "Неделя позади" : weekTitle(monday);

  return (
    <Sheet footer={<UnderstoodButton weekStart={monday} />}>
      <div className="flex items-center justify-between">
        <Eyebrow>{label}</Eyebrow>
        <div className="flex gap-1">
          <WeekLink monday={addDays(monday, -7)} label="Предыдущая неделя">‹</WeekLink>
          {monday < current && <WeekLink monday={addDays(monday, 7)} label="Следующая неделя">›</WeekLink>}
        </div>
      </div>

      {r.avgKcal == null ? (
        <>
          <p className="mt-6 text-[17px] leading-relaxed text-ink-2">
            {r.loggedDays === 0 ? "За эту неделю записей нет." : "Записей за неделю слишком мало для разбора."}
          </p>
          <p className="mt-2 font-mono text-[13px] tracking-[0.06em] text-ink-3">{weekTitle(monday)}</p>
        </>
      ) : (
        <>
          <div className="mt-3">
            <BigNumber value={r.avgKcal} caption={<>ккал в день · норма {formatInt(r.norm)}</>} />
          </div>
          <Eyebrow className="mt-4">
            {r.loggedDays} из 7 {plural(7, ["дня", "дней", "дней"])}
            {monday !== latest && !inProgress ? "" : ` · ${weekTitle(monday)}`}
          </Eyebrow>
          <WeekChart days={r.chart} norm={r.norm} corridor={r.corridor} />

          {r.good.length > 0 && (
            <>
              <SectionTitle>Что получилось</SectionTitle>
              <MarkList kind="ok" items={r.good} />
            </>
          )}
          {r.watch.length > 0 && (
            <>
              <SectionTitle>На что посмотреть</SectionTitle>
              <MarkList kind="warn" items={r.watch} />
            </>
          )}
          {r.topUp.length > 0 && (
            <>
              <SectionTitle>Чем добрать на этой неделе</SectionTitle>
              <MarkList kind="leaf" items={r.topUp.map((t) => t.text)} />
            </>
          )}
          {r.note && <p className="mt-6 text-[13px] leading-snug text-ink-3">{r.note}</p>}
        </>
      )}
    </Sheet>
  );
}

function WeekLink({ monday, label, children }: { monday: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={`/week?w=${monday}`}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-full bg-surface text-[20px] leading-none text-ink-2"
    >
      {children}
    </Link>
  );
}
