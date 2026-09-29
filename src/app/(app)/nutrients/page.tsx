import Link from "next/link";
import { redirect } from "next/navigation";
import { dayTitle, isIsoDate, todayIn } from "@/domain/day";
import { MICROS, NUTRIENT_KEYS, type NutrientKey } from "@/domain/nutrients";
import { loadDay } from "@/lib/diary";
import { loadUser } from "@/lib/norms";
import { requireSession } from "@/lib/session";
import { userTimeZone } from "@/lib/tz";
import { Eyebrow, SectionTitle } from "@/ui/components";
import { fmtAmount, NUTRIENT_LABELS, unitRu } from "@/ui/nutrients";

/** % нормы по всем нутриентам за день. Неполные данные не выдаются за полные. */
export default async function NutrientsPage({ searchParams }: PageProps<"/nutrients">) {
  const session = await requireSession();
  const { norms } = await loadUser(session.user.id);
  if (!norms) redirect("/onboarding");
  const tz = await userTimeZone(session.user.id);
  const sp = await searchParams;
  const date = typeof sp.d === "string" && isIsoDate(sp.d) ? sp.d : todayIn(tz);
  const { entries } = await loadDay(session.user.id, date, tz);

  const rows = NUTRIENT_KEYS.filter((k) => norms.nutrients[k] && k !== "kcal").map((k) => {
    const known = entries.filter((e) => e.nutrients[k] != null);
    return {
      key: k,
      norm: norms.nutrients[k]!,
      // Сумма по тем записям, где значение известно; missing — у скольких нет данных.
      value: known.reduce((s, e) => s + (e.nutrients[k] ?? 0), 0),
      missing: entries.length - known.length,
    };
  });
  const micros = new Set<NutrientKey>(MICROS);

  const Row = ({ r }: { r: (typeof rows)[number] }) => {
    const pct = r.norm.value > 0 ? (r.value / r.norm.value) * 100 : 0;
    const over = r.norm.kind === "limit" && r.value > r.norm.value;
    const done = r.norm.kind !== "limit" && pct >= 100;
    return (
      <li className="py-3">
        <div className="flex items-baseline justify-between gap-3 text-[15px]">
          <span className="font-semibold text-ink">{NUTRIENT_LABELS[r.key]}</span>
          <span className="tabular text-ink-2">
            {fmtAmount(r.value)}
            {r.missing > 0 && "+"} / {r.norm.kind === "limit" ? "≤ " : ""}
            {fmtAmount(r.norm.value)} {unitRu(r.key)}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, pct)}%`,
              background: over ? "var(--color-warn)" : done ? "var(--color-ok)" : "var(--color-accent)",
            }}
          />
        </div>
        {r.missing > 0 && (
          <p className="mt-1 text-[12px] text-ink-3">
            нет данных у {r.missing} из {entries.length} записей — на деле больше
          </p>
        )}
      </li>
    );
  };

  return (
    <main className="mx-auto max-w-xl px-6 pt-6 pb-16">
      <div className="flex items-center justify-between">
        <Eyebrow>Нутриенты · {dayTitle(date, tz).toLowerCase()}</Eyebrow>
        <Link href={`/?d=${date}`} className="text-[16px] font-semibold text-accent">
          Готово
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="mt-8 text-[16px] text-ink-2">За этот день записей нет.</p>
      ) : (
        <>
          <SectionTitle>Основное</SectionTitle>
          <ul className="divide-y divide-line">
            {rows.filter((r) => !micros.has(r.key)).map((r) => <Row key={r.key} r={r} />)}
          </ul>
          <SectionTitle>Витамины и минералы</SectionTitle>
          <ul className="divide-y divide-line">
            {rows.filter((r) => micros.has(r.key)).map((r) => <Row key={r.key} r={r} />)}
          </ul>
          <p className="mt-6 text-[13px] text-ink-3">
            Нормы — МР 2.3.1.0253-21, натрий — верхний предел ВОЗ. За один день недобор витаминов — не проблема:
            важна картина за неделю (недельный разбор).
          </p>
        </>
      )}
    </main>
  );
}
