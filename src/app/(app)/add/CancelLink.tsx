"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/components";

/**
 * Несохранённое на экране «Добавить» — сейчас это разобранный текст, который ещё
 * не в дневнике. Вкладки регистрируют его хуком useUnsavedWork; «Отмена» в шапке
 * (серверная страница) спрашивает перед уходом. Модуль — общий для вкладок и
 * шапки: у них нет общего клиентского родителя.
 */
const unsaved = new Set<symbol>();

/** Пока active — уход с экрана «Добавить» по «Отмене» надо подтвердить. */
export function useUnsavedWork(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const key = Symbol("unsaved");
    unsaved.add(key);
    return () => {
      unsaved.delete(key);
    };
  }, [active]);
}

/**
 * «Отмена» в шапке экрана «Добавить»: назад в дневник без записи. Раньше она
 * называлась «Готово» и выглядела как сохранение. Есть несохранённое — сначала
 * лист «Выйти без сохранения?».
 */
export function CancelLink({ href }: { href: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Link
        href={href}
        onClick={(e) => {
          // В новой вкладке (Cmd/Ctrl/Shift-клик) этот экран остаётся — спрашивать незачем.
          if (unsaved.size === 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          setAsking(true);
        }}
        className="shrink-0 text-[16px] font-semibold text-accent"
      >
        Отмена
      </Link>
      {asking && (
        <BottomSheet label="Выйти без сохранения?" onClose={() => setAsking(false)}>
          <div className="px-6">
            <h2 className="text-[19px] leading-snug font-bold text-ink">Выйти без сохранения?</h2>
            <p className="mt-2 text-[15px] leading-snug text-ink-2">Разобранные продукты ещё не в дневнике — они пропадут.</p>
            <Button className="mt-5" onClick={() => setAsking(false)}>
              Остаться
            </Button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                router.push(href);
              }}
              className="mt-2 w-full py-3 text-[16px] font-semibold text-warn"
            >
              Выйти без сохранения
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
