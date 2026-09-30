"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useKeyboardInset } from "./useKeyboardInset";

/**
 * Лист снизу поверх экрана — как PortionSheet: затемнение, скругление сверху,
 * отступ под индикатор «Домой». Esc закрывает, страница под листом не
 * прокручивается. Прокрутку внутри (если нужна) делает содержимое.
 * dismissible=false — тап по затемнению не закрывает: в форме жалко набранного.
 * Клавиатура iOS ложится поверх страницы — лист поднимается над ней и
 * становится ниже, поле в фокусе и кнопки остаются досягаемы.
 */
export function BottomSheet({
  label,
  onClose,
  dismissible = true,
  children,
}: {
  label: string;
  onClose: () => void;
  dismissible?: boolean;
  children: ReactNode;
}) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  const dialog = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardInset();

  useEffect(() => {
    // Поле под листом (поиск ингредиента) могло остаться в фокусе: на iOS нажатие
    // кнопки его не снимает, и клавиатура закрыла бы кнопки листа.
    const active = document.activeElement;
    if (active instanceof HTMLElement && !dialog.current?.contains(active)) active.blur();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  // Клавиатура открылась — лист стал ниже, и поле в фокусе могло оказаться
  // под его краем: докручиваем содержимое до поля.
  useEffect(() => {
    if (!keyboard) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !dialog.current?.contains(active)) return;
    const raf = requestAnimationFrame(() => active.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(raf);
  }, [keyboard]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30"
      style={keyboard ? { paddingBottom: keyboard } : undefined}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        // Над клавиатурой индикатора «Домой» нет — отступ снизу обычный.
        style={keyboard ? { maxHeight: `calc(92dvh - ${keyboard}px)`, paddingBottom: 12 } : undefined}
        className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[var(--radius-sheet)] bg-bg pt-4 pb-[calc(20px+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 shrink-0 rounded-full bg-line" />
        {children}
      </div>
    </div>
  );
}
