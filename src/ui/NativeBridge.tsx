"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CHANGED_EVENT, isNative, syncNative } from "@/lib/native";

/** Внутри iOS-приложения: синхронизация с виджетом и Health при открытии и после изменений. */
export function NativeBridge() {
  const router = useRouter();
  useEffect(() => {
    if (!isNative()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Серию быстрых изменений (добавил, поправил) синхронизируем одним разом.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncNative(), 800);
    };
    schedule();
    // Пока приложение было свёрнуто, дневник мог измениться (кнопка «+» в виджете, Mac) —
    // перечитываем страницу с сервера.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      schedule();
    };
    window.addEventListener(CHANGED_EVENT, schedule);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CHANGED_EVENT, schedule);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  return null;
}
