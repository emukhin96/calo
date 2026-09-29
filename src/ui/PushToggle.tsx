"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";

type State = "loading" | "unsupported" | "ios-install" | "native" | "denied" | "off" | "on" | "unconfigured";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Включение напоминания о разборе недели (Web Push). */
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      // В iOS-приложении Web Push нет (WKWebView), а свои уведомления — позже.
      if (isNative()) return setState("native");
      const standalone = window.matchMedia("(display-mode: standalone)").matches;
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // На iOS Web Push есть только у приложения, добавленного на экран «Домой».
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      const keyRes = await fetch("/api/push/key");
      if (!keyRes.ok) return setState("unconfigured");
      const { key } = await keyRes.json();
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("subscribe failed");
      setState("on");
    } catch {
      setMessage("Не получилось включить уведомления.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setState("off");
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    const res = await fetch("/api/push/test", { method: "POST" });
    const { sent } = res.ok ? await res.json() : { sent: 0 };
    setMessage(sent ? "Отправлено — уведомление придёт через пару секунд." : "Не отправилось — попробуйте выключить и включить снова.");
    setBusy(false);
  }

  const hint: Record<State, string> = {
    loading: "",
    unsupported: "Этот браузер не поддерживает уведомления.",
    "ios-install": "На iPhone уведомления работают, когда Calo добавлен на экран «Домой» (Поделиться → На экран «Домой»), iOS 16.4+.",
    native: "В приложении напоминаний пока нет — разбор недели откроется сам при первом входе в понедельник.",
    denied: "Уведомления запрещены. Разрешите их в настройках: Настройки → Уведомления → Calo.",
    unconfigured: "Уведомления на сервере ещё не настроены.",
    off: "В понедельник утром — «Разбор недели готов».",
    on: "Включено: в понедельник утром придёт напоминание о разборе недели.",
  };

  return (
    <div>
      <p className="text-[15px] text-ink-2">{hint[state]}</p>
      {state === "off" && (
        <button type="button" disabled={busy} onClick={enable} className="mt-3 rounded-2xl bg-accent px-4 py-2.5 text-[15px] font-bold text-white disabled:opacity-50">
          Включить уведомления
        </button>
      )}
      {state === "on" && (
        <div className="mt-3 flex gap-5 text-[15px] font-semibold">
          <button type="button" disabled={busy} onClick={test} className="text-accent disabled:opacity-50">
            Проверить
          </button>
          <button type="button" disabled={busy} onClick={disable} className="text-ink-3 disabled:opacity-50">
            Выключить
          </button>
        </div>
      )}
      {message && <p className="mt-2 text-[14px] text-ink-3">{message}</p>}
    </div>
  );
}
