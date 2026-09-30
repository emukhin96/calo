"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useSyncExternalStore } from "react";
import { localDate } from "@/lib/meal-choice";
import { useKeyboardInset } from "./useKeyboardInset";

type Tab = { href: string; label: string; active: (path: string) => boolean; icon: ReactNode };

const TABS: Tab[] = [
  {
    href: "/",
    label: "Дневник",
    // Нутриенты дня — часть дневника (туда ведут чипы БЖУ).
    active: (p) => p === "/" || p.startsWith("/nutrients"),
    icon: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2.5" />
        <path d="M9 8h6M9 12h6M9 16h3.5" />
      </>
    ),
  },
  {
    href: "/week",
    label: "Неделя",
    active: (p) => p.startsWith("/week"),
    icon: <path d="M4 20h16M7 16.5v-5M12 16.5V6.5M17 16.5v-8" />,
  },
  {
    href: "/recipes",
    label: "Блюда",
    active: (p) => p === "/recipes",
    icon: (
      <>
        <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" />
        <path d="M8.5 8c0-1.3 1-1.6 1-2.9M12 8c0-1.3 1-1.6 1-2.9M15.5 8c0-1.3 1-1.6 1-2.9" />
      </>
    ),
  },
  {
    href: "/settings",
    label: "Профиль",
    active: (p) => p.startsWith("/settings"),
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 20.5c1.4-3.6 4.2-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
      </>
    ),
  },
];

/** Экраны без вкладок: добавление, первый запуск, редактор блюда — у них своя кнопка внизу. */
const hiddenOn = (p: string) => p.startsWith("/add") || p.startsWith("/onboarding") || /^\/recipes\/./.test(p);

/** Дата телефона обновляется, когда приложение снова на экране (открыли утром). */
function subscribeDay(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
  };
}

/**
 * Нижняя панель вкладок: Дневник · Неделя · Блюда · Профиль. Высота —
 * --tabbar-h (globals.css), вместе с индикатором «Домой» — --tabbar-space:
 * на неё отступают страницы (pb-tabbar) и липкие панели. Пока открыта
 * клавиатура, панели нет — над клавиатурой остаются поле и его кнопки.
 */
export function TabBar() {
  const pathname = usePathname();
  const keyboard = useKeyboardInset();
  // «Дневник» — на сегодня явной датой: «/» без даты в первый вход после
  // недели открывает разбор, и вкладка возвращала бы в него, пока не нажато
  // «Понятно». На сервере и при гидратации — «/».
  const today = useSyncExternalStore(subscribeDay, () => localDate(), () => null);
  if (hiddenOn(pathname)) return null;

  return (
    <nav
      data-tabbar
      aria-label="Разделы"
      hidden={keyboard > 0}
      className="fixed inset-x-0 bottom-0 z-30 h-[var(--tabbar-space)] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid h-full max-w-xl grid-cols-4">
        {TABS.map((t) => {
          const on = t.active(pathname);
          return (
            <Link
              key={t.href}
              href={t.href === "/" && today ? `/?d=${today}` : t.href}
              aria-current={on ? "page" : undefined}
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold tracking-[0.01em] ${
                on ? "text-accent" : "text-ink-3"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className="size-[26px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={on ? 2 : 1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {t.icon}
              </svg>
              <span className="truncate">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
