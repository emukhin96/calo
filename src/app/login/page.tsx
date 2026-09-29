"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useIsNative } from "@/lib/native";
import { authClient } from "@/lib/auth-client";
import { Button, Eyebrow } from "@/ui/components";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const native = useIsNative();
  const [pasted, setPasted] = useState("");

  /** В приложении ссылка из письма откроется в Safari — её вставляют сюда. */
  function openPasted(e: React.FormEvent) {
    e.preventDefault();
    try {
      const url = new URL(pasted.trim());
      if (url.origin !== location.origin || !url.pathname.startsWith("/api/auth/magic-link/verify")) throw new Error();
      location.assign(url.href);
    } catch {
      setError("Это не ссылка для входа в Calo.");
    }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/" });
    if (error) {
      setError(error.message ?? "Не получилось отправить ссылку");
      setState("error");
    } else {
      setState("sent");
    }
  }

  async function signInWithPasskey() {
    setError("");
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setError("Face ID не сработал. Войдите по ссылке на почту.");
      return;
    }
    router.replace("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <Eyebrow>Calo</Eyebrow>
      <h1 className="mt-2 font-display text-[40px] leading-tight font-extrabold">Вход</h1>

      {!native && (
        <Button type="button" onClick={signInWithPasskey} className="mt-10">
          Войти с Face ID
        </Button>
      )}

      <div className="my-8 flex items-center gap-4 text-ink-3">
        <div className="h-px flex-1 bg-line" />
        <span className="font-mono text-[13px] tracking-[0.06em]">или по ссылке</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      {state === "sent" ? (
        <p className="text-[17px] leading-relaxed text-ink-2">
          Ссылка для входа отправлена на <b className="text-ink">{email}</b>. Она действует 15 минут.
        </p>
      ) : (
        <form onSubmit={sendLink} className="space-y-4">
          <input
            type="email"
            required
            autoComplete="email webauthn"
            inputMode="email"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-[60px] w-full rounded-[var(--radius-button)] border border-line bg-surface px-5 text-[17px] outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="h-[60px] w-full rounded-[var(--radius-button)] border-2 border-accent text-[17px] font-bold text-accent disabled:opacity-50"
          >
            {state === "sending" ? "Отправляю…" : "Прислать ссылку"}
          </button>
        </form>
      )}

      {native && (
        <form onSubmit={openPasted} className="mt-8 space-y-3">
          <p className="text-[15px] text-ink-2">Получили ссылку? Скопируйте её и вставьте сюда — вход будет в приложении.</p>
          <input
            type="url"
            inputMode="url"
            placeholder="https://calc.egor.am/api/auth/magic-link/…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none focus:border-accent"
          />
          <Button type="submit" disabled={!pasted.trim()}>
            Войти по ссылке
          </Button>
        </form>
      )}

      {error && <p className="mt-4 text-[15px] text-warn">{error}</p>}
    </main>
  );
}
