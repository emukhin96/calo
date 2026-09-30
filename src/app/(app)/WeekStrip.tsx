import Link from "next/link";
import type { KcalStatus, StripDay } from "@/lib/diary-view";

/** Точка под днём: в коридоре нормы — зелёная, сверх — оранжевая, меньше — серая. */
const DOT: Record<KcalStatus, string> = { ok: "bg-ok", above: "bg-warn", below: "bg-ink-3/50" };
/** На синей плашке выбранного дня серая точка не видна — белая. */
const DOT_ON_ACCENT: Record<KcalStatus, string> = { ok: "bg-ok", above: "bg-warn", below: "bg-white/70" };

/** «среда, 30 сентября». */
export const fullDate = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );

/**
 * Полоса недели над дневником: пн–вс, выбранный день — синяя плашка, сегодня —
 * синий контур, будущие дни бледные и не нажимаются. Стрелки — на неделю
 * назад / вперёд (вперёд — не дальше сегодня).
 */
export function WeekStrip({ days, prev, next }: { days: StripDay[]; prev: string; next: string | null }) {
  return (
    <nav aria-label="Дни недели" className="-mx-3 flex items-stretch">
      <Arrow href={`/?d=${prev}`} label="Предыдущая неделя" dir="prev" />
      <ol className="grid min-w-0 flex-1 grid-cols-7 gap-0.5">
        {days.map((d) => (
          <li key={d.date} className="min-w-0">
            <Day d={d} />
          </li>
        ))}
      </ol>
      {next ? <Arrow href={`/?d=${next}`} label="Следующая неделя" dir="next" /> : <span aria-hidden className="w-7 shrink-0" />}
    </nav>
  );
}

function Day({ d }: { d: StripDay }) {
  const tone = d.selected
    ? "bg-accent text-white"
    : d.today
      ? "text-accent ring-1 ring-accent/50 ring-inset"
      : d.future
        ? "text-ink-3 opacity-40"
        : "text-ink";
  const dots = d.selected ? DOT_ON_ACCENT : DOT;
  const body = (
    <>
      <span className={`text-[12px] font-semibold ${d.selected || d.today ? "" : "text-ink-3"}`}>{d.weekday}</span>
      <span className="tabular text-[17px] leading-6 font-bold">{d.day}</span>
      <span aria-hidden className={`mt-0.5 size-1.5 rounded-full ${d.status ? dots[d.status] : ""}`} />
    </>
  );
  const cls = `flex flex-col items-center rounded-2xl pt-1.5 pb-2 ${tone}`;
  if (d.future) return <span className={cls}>{body}</span>;
  return (
    <Link href={`/?d=${d.date}`} aria-label={fullDate(d.date)} aria-current={d.selected ? "date" : undefined} className={cls}>
      {body}
    </Link>
  );
}

function Arrow({ href, label, dir }: { href: string; label: string; dir: "prev" | "next" }) {
  return (
    <Link href={href} aria-label={label} className="flex w-7 shrink-0 items-center justify-center text-ink-3">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === "prev" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6"} />
      </svg>
    </Link>
  );
}
