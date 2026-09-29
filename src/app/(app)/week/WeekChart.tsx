import { formatInt } from "@/ui/format";

const WD = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/** Калории по дням: столбики, полоса коридора нормы и линия нормы. Без библиотек. */
export function WeekChart({
  days,
  norm,
  corridor: [lo, hi],
}: {
  days: { date: string; kcal: number; complete: boolean }[];
  norm: number;
  corridor: [number, number];
}) {
  const H = 72;
  const max = Math.max(hi * 1.1, ...days.map((d) => d.kcal));
  const y = (v: number) => H - (v / max) * H;
  return (
    <figure className="mt-5" aria-label={`Калории по дням, норма ${formatInt(norm)}`}>
      <div className="relative" style={{ height: H }}>
        <div className="absolute inset-x-0 rounded bg-ok/15" style={{ top: y(hi), height: y(lo) - y(hi) }} />
        <div className="absolute inset-x-0 border-t border-dashed border-ink-3/50" style={{ top: y(norm) }} />
        <div className="absolute inset-0 grid grid-cols-7 items-end gap-2">
          {days.map((d) => {
            const inside = d.kcal >= lo && d.kcal <= hi;
            return (
              <div
                key={d.date}
                title={`${formatInt(d.kcal)} ккал`}
                className="mx-auto w-full max-w-7 rounded-t-md"
                style={{
                  height: Math.max(d.kcal > 0 ? 3 : 0, H - y(d.kcal)),
                  background: !d.complete ? "var(--color-line)" : inside ? "var(--color-accent)" : "var(--color-warn)",
                }}
              />
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-2 text-center font-mono text-[11px] text-ink-3">
        {WD.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
    </figure>
  );
}
