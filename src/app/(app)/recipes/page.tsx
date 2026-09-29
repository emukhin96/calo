import Link from "next/link";
import { db } from "@/db";
import { listRecipes } from "@/db/recipes";
import { requireSession } from "@/lib/session";
import { Eyebrow } from "@/ui/components";
import { formatInt } from "@/ui/format";

/** «Мои блюда»: рецепты из ингредиентов и шаблоны со своим КБЖУ. */
export default async function RecipesPage() {
  const session = await requireSession();
  const items = await listRecipes(db, session.user.id);
  return (
    <main className="mx-auto max-w-xl px-6 pt-6 pb-24">
      <div className="flex items-center justify-between">
        <Eyebrow>Мои блюда</Eyebrow>
        <Link href="/" className="text-[16px] font-semibold text-accent">
          Готово
        </Link>
      </div>
      <h1 className="mt-2 font-display text-[28px] font-extrabold">Мои блюда</h1>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Link href="/recipes/new?kind=composite" className="rounded-2xl bg-accent px-4 py-3 text-[15px] font-bold text-white">
          + Из ингредиентов
          <span className="block text-[13px] font-normal opacity-80">паста, салат, каша</span>
        </Link>
        <Link href="/recipes/new?kind=template" className="rounded-2xl bg-surface px-4 py-3 text-[15px] font-bold text-ink">
          + Своё КБЖУ
          <span className="block text-[13px] font-normal text-ink-3">из меню или с упаковки</span>
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 text-[15px] leading-relaxed text-ink-2">
          Пока пусто. Блюдо можно собрать из ингредиентов, задать своё КБЖУ или сохранить любую запись дневника — кнопка
          «Сохранить как блюдо» в записи.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line">
          {items.map((r) => {
            const portion = r.defaultPortionG;
            return (
              <li key={r.id}>
                <Link href={`/recipes/${r.id}`} className="flex items-baseline gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold text-ink">{r.name}</span>
                    <span className="text-[13px] text-ink-3">
                      {r.kind === "composite" ? "из ингредиентов" : "своё КБЖУ"}
                      {r.useCount > 0 && ` · ели ${r.useCount} раз`}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-right text-[14px] text-ink-2">
                    {portion
                      ? `${formatInt(((r.nutrientsPer100g.kcal ?? 0) * portion) / 100)} ккал · ${formatInt(portion)} г`
                      : `${formatInt(r.nutrientsPer100g.kcal ?? 0)} ккал / 100 г`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
