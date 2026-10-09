"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { authClient } from "@/lib/auth-client";
import { type DeletedWho, signInErrorText } from "@/lib/auth-errors";
import { useIsInstalledApp, useIsNative } from "@/lib/native";
import { clearLocalUserState } from "@/lib/sign-out";
import { Button, Eyebrow } from "@/ui/components";

const outlineButton =
  "h-[60px] w-full rounded-[var(--radius-button)] border-2 border-accent text-[17px] font-bold text-accent disabled:opacity-50";

/**
 * Вход и регистрация сразу: новый адрес — новый аккаунт (better-auth создаёт его
 * при переходе по ссылке, дальше — анкета). linkError — текст для ?error= из ссылки,
 * deleted — пришли после удаления аккаунта (?deleted=1 и cookie от сервера, page.tsx):
 * self — аккаунта этого браузера, other — чужого, а здесь вошёл другой. signupClosed —
 * SIGNUP=closed: новым адресам аккаунт не обещаем.
 */
export function LoginForm({
  linkError,
  deleted,
  signupClosed,
}: {
  linkError: string | null;
  deleted: DeletedWho | null;
  signupClosed: boolean;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState(linkError ?? "");
  const native = useIsNative();
  // В приложении и с экрана «Домой» ссылка из письма откроется в Safari, а не здесь.
  const installed = useIsInstalledApp();
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Сервер аккаунт этого браузера уже удалил — подчищаем то, что осталось здесь и в
    // приложении. other — удалили чужой аккаунт, а здесь вошёл другой: его офлайн-записи
    // и кэши не трогаем.
    if (deleted === "self") void clearLocalUserState();
    // Убираем ?error= и ?deleted= из адреса: перезагрузка не должна повторять сообщение.
    // После эффектов роутера Next (setTimeout): тогда replaceState уже его обёртка — она
    // сохранит своё служебное состояние и запомнит чистый адрес, и router.refresh
    // (приложение при возврате из Почты) не вернёт ?error= в адресную строку.
    if (!location.search) return;
    const t = setTimeout(() => history.replaceState(null, "", location.pathname), 0);
    return () => clearTimeout(t);
  }, [deleted]);

  /** В приложении и на экране «Домой» ссылка из письма откроется в Safari — её вставляют сюда. */
  function openPasted(e: React.FormEvent) {
    e.preventDefault();
    try {
      const url = new URL(pasted.trim());
      if (url.origin !== location.origin || !url.pathname.startsWith("/api/auth/magic-link/verify")) throw new Error();
      location.assign(url.href);
    } catch {
      setPasteError("Это не ссылка для входа в Calo.");
    }
  }

  async function sendLink(again = false) {
    setSending(true);
    setError("");
    setResent(false);
    try {
      const { error } = await authClient.signIn.magicLink({
        email,
        callbackURL: "/",
        newUserCallbackURL: "/onboarding",
        errorCallbackURL: "/login",
      });
      if (error) {
        setError(signInErrorText(error));
      } else {
        setSent(true);
        setResent(again);
      }
    } catch (e) {
      setError(signInErrorText(e));
    } finally {
      setSending(false);
    }
  }

  /** Назад к форме с тем же адресом; фокус — сразу, пока идёт нажатие: так iOS покажет клавиатуру. */
  function changeEmail() {
    flushSync(() => {
      setSent(false);
      setResent(false);
      setError("");
    });
    emailRef.current?.focus();
  }

  async function signInWithPasskey() {
    setError("");
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setError("Face ID не сработал. Войдите по ссылке на почту.");
      return;
    }
    // Полная загрузка, а не router.replace: OwnerGuard в (app)/layout должен увидеть новый
    // аккаунт раньше, чем OfflineSync отправит офлайн-очередь, оставшуюся от прошлого.
    location.replace("/");
  }

  return (
    // min-h-app, а не min-h-dvh: вместе с отступом body под чёлку экран входа не прокручивается.
    <main className="mx-auto flex min-h-app max-w-md flex-col justify-center px-6 pt-10 pb-[calc(40px+env(safe-area-inset-bottom))]">
      <Eyebrow>Calo</Eyebrow>
      <h1 className="mt-2 font-display text-[40px] leading-tight font-extrabold">Вход</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
        {signupClosed
          ? "Регистрация новых пользователей временно закрыта."
          : "Впервые здесь? Введите почту — пришлём ссылку, аккаунт создастся сам."}
      </p>

      {deleted && (
        <p role="status" className="mt-6 rounded-2xl bg-surface p-4 text-[16px] leading-snug text-ink">
          Аккаунт и все данные удалены.
        </p>
      )}

      {!native && (
        <Button type="button" onClick={signInWithPasskey} className="mt-10">
          Войти с Face ID
        </Button>
      )}

      {native ? (
        <div className="h-8" />
      ) : (
        <div className="my-8 flex items-center gap-4 text-ink-3">
          <div className="h-px flex-1 bg-line" />
          <span className="font-mono text-[13px] tracking-[0.06em]">или по ссылке</span>
          <div className="h-px flex-1 bg-line" />
        </div>
      )}

      {/* Живая область: читалка экрана объявит «Ссылка отправлена…» вместо формы. */}
      <div aria-live="polite">
        {sent ? (
          <div>
            <p className="text-[17px] leading-relaxed text-ink-2">
              Ссылка для входа отправлена на <b className="text-ink wrap-anywhere">{email}</b>. Она действует 15 минут.
              Письма нет — проверьте папку «Спам».
            </p>
            {resent && <p className="mt-3 text-[15px] text-ink-3">Отправили ещё одно письмо.</p>}
            <div className="mt-6 space-y-2">
              <button type="button" onClick={() => sendLink(true)} disabled={sending} className={outlineButton}>
                {sending ? "Отправляю…" : "Отправить ещё раз"}
              </button>
              <button type="button" onClick={changeEmail} className="h-[52px] w-full text-[17px] font-semibold text-accent">
                Другой адрес
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendLink();
            }}
            className="space-y-4"
          >
            <label htmlFor="login-email" className="sr-only">
              Почта
            </label>
            <input
              ref={emailRef}
              id="login-email"
              type="email"
              required
              maxLength={254}
              autoComplete="email webauthn"
              inputMode="email"
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-[60px] w-full rounded-[var(--radius-button)] border border-line bg-surface px-5 text-[17px] outline-none focus:border-accent"
            />
            <button type="submit" disabled={sending} className={outlineButton}>
              {sending ? "Отправляю…" : "Прислать ссылку"}
            </button>
            <p className="text-[13px] leading-snug text-ink-3">
              Продолжая, вы соглашаетесь с{" "}
              <Link href="/privacy" className="underline underline-offset-2">
                условиями обработки данных
              </Link>
              .
            </p>
          </form>
        )}
      </div>

      <div role="alert">{error && <p className="mt-4 text-[15px] text-warn">{error}</p>}</div>

      {installed && (
        <>
          <form onSubmit={openPasted} className="mt-8 space-y-3">
            <label htmlFor="login-pasted" className="block text-[15px] text-ink-2">
              Получили ссылку? Скопируйте её и вставьте сюда — вход будет в приложении.
            </label>
            <input
              id="login-pasted"
              type="url"
              inputMode="url"
              placeholder="https://calc.egor.am/api/auth/magic-link/…"
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setPasteError("");
              }}
              className="h-[52px] w-full rounded-2xl border border-line bg-surface px-4 text-[17px] outline-none focus:border-accent"
            />
            <Button type="submit" disabled={!pasted.trim()}>
              Войти по ссылке
            </Button>
          </form>
          <div role="alert">{pasteError && <p className="mt-3 text-[15px] text-warn">{pasteError}</p>}</div>
        </>
      )}
    </main>
  );
}
