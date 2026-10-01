"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useIsInstalledApp } from "@/lib/native";
import { queued } from "@/lib/offline";
import { clearLocalUserState, signOutAndClear } from "@/lib/sign-out";
import { SectionTitle } from "@/ui/components";
import { deleteAccountErrorText, deleteLinkFrom, deleteStateAfterError, unsentWarning } from "./account";

/**
 * Когда в этой вкладке ушло письмо об удалении на адрес. В sessionStorage, а не в
 * состоянии: повторно «Удалить аккаунт» нажимают, уйдя из Профиля и вернувшись.
 */
const sentKey = (email: string) => `calo:delete-link-sent:${email}`;
function deleteLinkSentAt(email: string): number | null {
  try {
    return Number(sessionStorage.getItem(sentKey(email))) || null;
  } catch {
    return null;
  }
}
function rememberDeleteLinkSent(email: string) {
  try {
    sessionStorage.setItem(sentKey(email), String(Date.now()));
  } catch {}
}

/** Аккаунт: выход и удаление аккаунта (по ссылке из письма — случайное нажатие ничего не сотрёт). */
export function AccountSection({ email, timezone }: { email: string; timezone: string }) {
  const installed = useIsInstalledApp();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [del, setDel] = useState<"idle" | "confirm" | "sending" | "sent">("idle");
  const [delError, setDelError] = useState("");
  const [pasted, setPasted] = useState("");

  async function signOut() {
    const warning = unsentWarning(queued().length);
    if (warning && !window.confirm(warning)) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOutAndClear();
      // Полная загрузка, а не router.replace: в памяти не остаётся ни страниц, ни сессии прошлого аккаунта.
      location.replace("/login");
    } catch {
      setSignOutError("Не получилось выйти. Проверьте интернет и попробуйте снова.");
      setSigningOut(false);
    }
  }

  async function requestDelete() {
    setDel("sending");
    setDelError("");
    try {
      const { data, error } = await authClient.deleteUser({ callbackURL: "/login?deleted=1" });
      if (error) throw error;
      // Сервер без подтверждения письмом удаляет сразу — тогда уже всё.
      if (data?.message === "User deleted") {
        await clearLocalUserState();
        location.replace("/login?deleted=1");
        return;
      }
      rememberDeleteLinkSent(email);
      setDel("sent");
    } catch (e) {
      setDelError(deleteAccountErrorText(e));
      setDel(deleteStateAfterError(e, deleteLinkSentAt(email), Date.now()));
    }
  }

  function openPasted(e: React.FormEvent) {
    e.preventDefault();
    const href = deleteLinkFrom(pasted, location.origin);
    if (href) location.assign(href);
    else setDelError("Это не ссылка для удаления аккаунта Calo.");
  }

  return (
    <>
      <SectionTitle>Аккаунт</SectionTitle>
      <p className="text-[15px] text-ink-2 wrap-anywhere">{email}</p>
      <p className="mt-1 text-[14px] text-ink-3 wrap-anywhere">Часовой пояс: {timezone}</p>
      <button type="button" disabled={signingOut} onClick={signOut} className="mt-4 text-[16px] font-semibold text-warn disabled:opacity-50">
        {signingOut ? "Выхожу…" : "Выйти"}
      </button>
      {signOutError && <p className="mt-2 text-[14px] text-warn">{signOutError}</p>}

      {del === "idle" && (
        <button type="button" onClick={() => setDel("confirm")} className="mt-5 block text-[15px] font-semibold text-ink-3">
          Удалить аккаунт
        </button>
      )}

      {(del === "confirm" || del === "sending") && (
        <div className="mt-5 rounded-2xl bg-surface p-4">
          <p className="text-[17px] font-bold text-ink">Удалить аккаунт?</p>
          <p className="mt-2 text-[15px] leading-snug text-ink-2">
            Удалятся все записи дневника, блюда, свои продукты, вес и настройки. Это необратимо — восстановить их будет нельзя.
          </p>
          <p className="mt-2 text-[15px] leading-snug text-ink-2">
            Сначала можно{" "}
            <a href="/api/export" download className="font-semibold text-accent">
              скачать дневник (CSV)
            </a>
            .
          </p>
          <p className="mt-2 text-[14px] text-ink-3 wrap-anywhere">Для подтверждения пришлём письмо на {email}.</p>
          {delError && <p className="mt-3 text-[14px] text-warn">{delError}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button
              type="button"
              disabled={del === "sending"}
              onClick={requestDelete}
              className="rounded-xl bg-warn px-4 py-2.5 text-[15px] font-bold text-white disabled:opacity-50"
            >
              {del === "sending" ? "Отправляю…" : "Да, удалить"}
            </button>
            <button
              type="button"
              disabled={del === "sending"}
              onClick={() => {
                setDel("idle");
                setDelError("");
              }}
              className="text-[15px] font-semibold text-ink-3 disabled:opacity-50"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {del === "sent" && (
        <div className="mt-5 rounded-2xl bg-surface p-4">
          <p className="text-[15px] leading-relaxed text-ink-2">
            Мы отправили письмо на <b className="text-ink wrap-anywhere">{email}</b> — откройте ссылку в нём в течение часа, чтобы
            удалить аккаунт.
          </p>
          {/* Зачем вставлять ссылку в приложении и с экрана «Домой» — см. deleteLinkFrom. */}
          {installed && (
            <form onSubmit={openPasted} className="mt-4 space-y-3">
              <p className="text-[14px] text-ink-3">
                Чтобы Calo на этом устройстве тоже всё забыл, скопируйте ссылку из письма и вставьте сюда.
              </p>
              <input
                type="url"
                inputMode="url"
                placeholder="Ссылка из письма"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                className="h-[52px] w-full rounded-2xl border border-line bg-bg px-4 text-[17px] outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!pasted.trim()}
                className="rounded-xl bg-warn px-4 py-2.5 text-[15px] font-bold text-white disabled:opacity-50"
              >
                Удалить аккаунт
              </button>
            </form>
          )}
          {delError && <p className="mt-3 text-[14px] text-warn">{delError}</p>}
        </div>
      )}
    </>
  );
}
