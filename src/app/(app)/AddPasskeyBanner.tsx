"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { isNative } from "@/lib/native";

/** После первого входа по ссылке предлагает включить вход по Face ID. */
export function AddPasskeyBanner() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // В iOS-приложении passkey в WebView не работает без Associated Domains — не предлагаем.
    if (!window.PublicKeyCredential || isNative()) return;
    authClient.passkey.listUserPasskeys().then(({ data }) => setShow((data?.length ?? 0) === 0));
  }, []);

  if (!show) return null;

  async function add() {
    setBusy(true);
    const res = await authClient.passkey.addPasskey({ name: navigator.platform || "iPhone" });
    setBusy(false);
    if (!res?.error) setShow(false);
  }

  return (
    <div className="mt-6 flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-sm">
      <p className="flex-1 text-[15px] leading-snug text-ink-2">
        Включите вход по Face ID — без писем и паролей.
      </p>
      <button
        type="button"
        onClick={add}
        disabled={busy}
        className="rounded-xl bg-accent px-4 py-2.5 text-[15px] font-bold text-white disabled:opacity-50"
      >
        Включить
      </button>
    </div>
  );
}
