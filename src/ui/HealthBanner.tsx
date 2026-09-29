"use client";

import { useState } from "react";
import { health, notifyChanged, useHealthEnabled, useIsNative } from "@/lib/native";

const DISMISS_KEY = "calo:health:banner-dismissed";

/** Главный экран iOS-приложения: предложить подключить «Здоровье» одним нажатием. */
export function HealthBanner() {
  const native = useIsNative();
  const enabled = useHealthEnabled();
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  if (!native || enabled || hidden) return null;

  async function connect() {
    setBusy(true);
    if (await health.connect()) notifyChanged();
    setBusy(false);
  }
  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setHidden(true);
  }

  return (
    <div className="mt-6 flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-sm">
      <p className="flex-1 text-[15px] leading-snug text-ink-2">
        Записывать съеденное в «Здоровье» и брать оттуда вес.{" "}
        <button type="button" onClick={dismiss} className="text-ink-3 underline">
          Не сейчас
        </button>
      </p>
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="rounded-xl bg-accent px-4 py-2.5 text-[15px] font-bold text-white disabled:opacity-50"
      >
        Подключить
      </button>
    </div>
  );
}
