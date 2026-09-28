import Link from "next/link";
import { requireSession } from "@/lib/session";
import { BigNumber, Eyebrow, MacroBar, SectionTitle } from "@/ui/components";
import { formatInt } from "@/ui/format";
import { AddPasskeyBanner } from "./AddPasskeyBanner";
import { demoToday } from "./demo-data";

export default async function TodayPage() {
  await requireSession();
  const d = demoToday;
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <main className="mx-auto max-w-xl px-6 pt-8 pb-32">
      <Eyebrow>Сегодня · {today}</Eyebrow>
      <div className="mt-3">
        <BigNumber value={d.kcal} caption={<>ккал · норма {formatInt(d.norm)}</>} />
      </div>
      <Eyebrow className="mt-3">осталось {formatInt(d.norm - d.kcal)} ккал</Eyebrow>

      <AddPasskeyBanner />

      <div className="mt-8 space-y-4">
        <MacroBar label="Белки" value={d.macros.protein[0]} norm={d.macros.protein[1]} color="var(--color-protein)" />
        <MacroBar label="Жиры" value={d.macros.fat[0]} norm={d.macros.fat[1]} color="var(--color-fat)" />
        <MacroBar label="Углеводы" value={d.macros.carbs[0]} norm={d.macros.carbs[1]} color="var(--color-carbs)" />
      </div>

      <SectionTitle>Приёмы пищи</SectionTitle>
      <ul className="divide-y divide-line">
        {d.meals.map((m) => (
          <li key={m.title} className="py-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[17px] font-bold">{m.title}</span>
              <span className="tabular text-[15px] text-ink-2">{formatInt(m.kcal)} ккал</span>
            </div>
            <p className="mt-1 text-[15px] text-ink-3">{m.items.join(" · ")}</p>
          </li>
        ))}
      </ul>

      <Link href="/week" className="mt-6 block text-[17px] font-semibold text-accent">
        Разбор прошлой недели →
      </Link>

      <p className="mt-10 font-mono text-[12px] tracking-[0.06em] text-ink-3">
        данные демонстрационные — дневник появится на этапе 2
      </p>

      <button
        type="button"
        aria-label="Добавить еду"
        className="fixed right-6 bottom-[calc(24px+env(safe-area-inset-bottom))] flex size-16 items-center justify-center rounded-full bg-accent text-[34px] leading-none text-white shadow-lg shadow-accent/30"
      >
        +
      </button>
    </main>
  );
}
