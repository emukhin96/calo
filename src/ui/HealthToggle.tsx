"use client";

import { useState } from "react";
import { health, notifyChanged, useHealthEnabled, useIsNative } from "@/lib/native";
import { SectionTitle } from "./components";

/** Настройки → Apple Health. Показывается только внутри iOS-приложения. */
export function HealthToggle() {
  const native = useIsNative();
  const enabled = useHealthEnabled();
  const [msg, setMsg] = useState("");

  if (!native) return null;

  async function connect() {
    setMsg("");
    const ok = await health.connect();
    if (ok) notifyChanged();
    else setMsg("Доступ не выдан. Разрешите его: Здоровье → Профиль → Приложения → Calo.");
  }

  return (
    <>
      <SectionTitle>Apple Health</SectionTitle>
      <p className="text-[15px] text-ink-2">
        {enabled
          ? "Подключено: съеденное записывается в «Здоровье» (калории, БЖУ, витамины), вес берётся оттуда."
          : "Записывать съеденное в «Здоровье» и брать оттуда вес."}
      </p>
      {enabled ? (
        <button
          type="button"
          onClick={() => health.disconnect()}
          className="mt-3 text-[15px] font-semibold text-ink-3"
        >
          Отключить
        </button>
      ) : (
        <button type="button" onClick={connect} className="mt-3 rounded-2xl bg-accent px-4 py-2.5 text-[15px] font-bold text-white">
          Подключить «Здоровье»
        </button>
      )}
      {msg && <p className="mt-2 text-[14px] text-ink-3">{msg}</p>}
    </>
  );
}
