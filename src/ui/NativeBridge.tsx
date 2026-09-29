"use client";

import { useEffect } from "react";
import { CHANGED_EVENT, isNative, syncNative } from "@/lib/native";

/** Внутри iOS-приложения: синхронизация с виджетом и Health при открытии и после изменений. */
export function NativeBridge() {
  useEffect(() => {
    if (!isNative()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Серию быстрых изменений (добавил, поправил) синхронизируем одним разом.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void syncNative(), 800);
    };
    schedule();
    const onVisible = () => document.visibilityState === "visible" && schedule();
    window.addEventListener(CHANGED_EVENT, schedule);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CHANGED_EVENT, schedule);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
