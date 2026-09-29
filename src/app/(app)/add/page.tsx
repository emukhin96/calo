import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Eyebrow } from "@/ui/components";
import { FoodSearch } from "./FoodSearch";

/**
 * «Добавить» — пока только вкладка «Продукт» (поиск по справочнику, этап 1).
 * Шаблоны, рецепт и фото появятся на этапах 4, 6, 7; запись в дневник — этап 2.
 */
export default async function AddPage() {
  await requireSession();
  return (
    <main className="mx-auto max-w-xl px-6 pt-8 pb-16">
      <div className="flex items-center justify-between">
        <Eyebrow>Добавить · продукт</Eyebrow>
        <Link href="/" className="text-[16px] font-semibold text-accent">
          Готово
        </Link>
      </div>
      <h1 className="mt-2 mb-6 font-display text-[28px] font-extrabold">Что съели?</h1>
      <FoodSearch />
    </main>
  );
}
