import Link from "next/link";
import { dayTitle, isIsoDate, mealByHour, MEALS, type Meal, todayIn, zonedParts } from "@/domain/day";
import { requireSession } from "@/lib/session";
import { userTimeZone } from "@/lib/tz";
import { Eyebrow } from "@/ui/components";
import { FoodSearch } from "./FoodSearch";

/**
 * «Добавить» — вкладка «Продукт»: поиск по справочнику → порция → запись.
 * /add?d=2026-09-29&meal=lunch. Шаблоны, рецепт и фото — этапы 4, 6, 7.
 */
export default async function AddPage({ searchParams }: PageProps<"/add">) {
  await requireSession();
  const tz = await userTimeZone();
  const sp = await searchParams;
  const d = typeof sp.d === "string" && isIsoDate(sp.d) ? sp.d : todayIn(tz);
  const meal: Meal =
    typeof sp.meal === "string" && (MEALS as string[]).includes(sp.meal)
      ? (sp.meal as Meal)
      : mealByHour(zonedParts(new Date(), tz).hour);

  return (
    <main className="mx-auto max-w-xl px-6 pt-8 pb-16">
      <div className="flex items-center justify-between">
        <Eyebrow>Добавить · {dayTitle(d, tz).toLowerCase()}</Eyebrow>
        <Link href={`/?d=${d}`} className="text-[16px] font-semibold text-accent">
          Готово
        </Link>
      </div>
      <h1 className="mt-2 mb-6 font-display text-[28px] font-extrabold">Что съели?</h1>
      <FoodSearch date={d} meal={meal} />
    </main>
  );
}
