"use client";

import { useEffect } from "react";
import { clearLocalUserState } from "@/lib/sign-out";

/** id аккаунта, который последним входил на этом устройстве. */
export const OWNER_KEY = "calo:owner";

/**
 * Вошёл другой аккаунт, а прошлый не выходил кнопкой «Выйти» (сессия истекла, аккаунт
 * удалили по ссылке в Safari) — убираем за прошлым, как при выходе: иначе новому
 * достались бы его офлайн-очередь, кэши, «Здоровье» и виджет.
 * Эффект из layout приложения срабатывает раньше OfflineSync и NativeBridge (они
 * в корневом layout после страницы), а localStorage clearLocalUserState чистит
 * синхронно, до первого await, — чужая очередь отправиться не успеет. Только в этой
 * вкладке: OfflineSync другой открытой вкладки может успеть отправить старую очередь
 * в первые секунды после входа нового аккаунта — редкий случай, не закрываем.
 */
export function OwnerGuard({ userId }: { userId: string }) {
  useEffect(() => {
    try {
      const prev = localStorage.getItem(OWNER_KEY);
      if (prev === userId) return;
      if (prev) void clearLocalUserState();
      localStorage.setItem(OWNER_KEY, userId);
    } catch {
      // нет localStorage — нечего и убирать
    }
  }, [userId]);
  return null;
}
