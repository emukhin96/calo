"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { isNative } from "@/lib/native";
import { addPasskeyErrorText } from "./add-passkey";

// С префиксом calo: — выход (lib/sign-out) его стирает: следующему аккаунту предложим снова.
const DISMISS_KEY = "calo:passkey:banner-dismissed";

function dismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** После первого входа по ссылке предлагает включить вход по Face ID. */
export function AddPasskeyBanner() {
  // null — баннер не показываем; строка — показываем, это email для имени passkey.
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // В iOS-приложении passkey в WebView не работает без Associated Domains — не предлагаем.
    if (!window.PublicKeyCredential || isNative() || dismissed()) return;
    (async () => {
      const { data, error } = await authClient.passkey.listUserPasskeys();
      // Список не загрузился — не предлагаем: вдруг Face ID уже включён.
      if (error || !data || data.length > 0) return;
      const session = await authClient.getSession();
      setEmail(session.data?.user.email ?? "");
    })().catch(() => {});
  }, []);

  if (email == null) return null;

  async function add() {
    setBusy(true);
    setMessage("");
    // Имя passkey — email: в «Паролях» iPhone видно, от какого аккаунта этот вход.
    const res = await authClient.passkey.addPasskey({ name: email || navigator.platform || "iPhone" }).catch(() => null);
    setBusy(false);
    if (res && !res.error) return setEmail(null);
    const text = addPasskeyErrorText(res?.error);
    if (text) setMessage(text);
  }
  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setEmail(null);
  }

  return (
    <div className="mt-6 rounded-2xl bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <p className="min-w-0 flex-1 text-[15px] leading-snug text-ink-2">
          Включите вход по Face ID — без писем и паролей.{" "}
          <button type="button" onClick={dismiss} className="text-ink-3 underline">
            Не сейчас
          </button>
        </p>
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-[15px] font-bold text-white disabled:opacity-50"
        >
          Включить
        </button>
      </div>
      {message && <p className="mt-3 text-[14px] text-warn">{message}</p>}
    </div>
  );
}
