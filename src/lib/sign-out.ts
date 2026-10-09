"use client";

// Выход из аккаунта и уборка за ним на этом устройстве. Всё локальное в Calo
// живёт на устройстве, а не в аккаунте: без уборки следующий вошедший получил бы
// чужую офлайн-очередь (она ушла бы в его дневник), кэши списков, страницы дневника
// из service worker, напоминания прошлого аккаунта и виджет с его сводкой.
import { authClient } from "./auth-client";
import { clearNativeState } from "./native";
import { QUEUE_EVENT } from "./offline";

/** Наши ключи localStorage: calo:queue:v1, calo:cache:*, calo:health:*, флаги баннеров. */
const LOCAL_PREFIX = "calo:";
/** Кэши service worker: calo-v2-static, calo-v2-pages (public/sw.js). */
const CACHE_PREFIX = "calo-";

/** Подписка этого браузера на Web Push (ui/PushToggle) или null. */
async function pushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager?.getSubscription()) ?? null;
}

/**
 * Стереть всё, что Calo хранит на устройстве о вошедшем. С сервером не говорит —
 * годится и после выхода, и после удаления аккаунта (/login?deleted=1). Не бросает.
 */
export async function clearLocalUserState(): Promise<void> {
  // Ключи calo:health:* — тоже: «Здоровье» подключается заново для каждого аккаунта.
  // Иначе на общем iPhone второй аккаунт получил бы вес из Health этого устройства,
  // а синхронизация удалила бы из Health записи первого как «удалённые».
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) if (key?.startsWith(LOCAL_PREFIX)) localStorage.removeItem(key);
    window.dispatchEvent(new Event(QUEUE_EVENT)); // счётчик «ждут отправки» — к нулю
  } catch {
    // приватный режим / нет localStorage — стирать нечего
  }

  const steps = [
    // Страницы дневника в кэше открылись бы без сети следующему; статика скачается заново.
    async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n)));
    },
    // Сервер отвязывает подписку в signOutAndClear; здесь — сам браузер.
    async () => {
      await (await pushSubscription())?.unsubscribe();
    },
    clearNativeState,
  ];
  await Promise.all(steps.map((step) => step().catch(() => {})));
}

/**
 * Выйти: отвязать push этого браузера от аккаунта, закрыть сессию, убрать за собой.
 * Бросает, если сервер выход не подтвердил (нет сети): тогда вход остаётся, и
 * локальное не трогаем — выйти можно ещё раз.
 */
export async function signOutAndClear(): Promise<void> {
  // Пока сессия жива — как «Выключить» в ui/PushToggle: иначе напоминания прошлого
  // аккаунта приходили бы сюда и после выхода.
  try {
    const sub = await pushSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    }
  } catch {}
  const { error } = await authClient.signOut();
  if (error) throw new Error(`sign out failed: ${error.status}`);
  await clearLocalUserState();
}
