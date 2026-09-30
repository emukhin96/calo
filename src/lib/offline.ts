"use client";

// Офлайн-очередь записей дневника: если отправить не удалось из-за сети,
// запись ждёт в localStorage и уходит при появлении сети (ui/OfflineSync).
// Время еды фиксируется в момент добавления (eatenAt), а не отправки.

const KEY = "calo:queue:v1";
export const QUEUE_EVENT = "calo:queue";

export type QueuedEntry = { id: string; body: Record<string, unknown>; title: string; queuedAt: string };

function read(): QueuedEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function write(q: QueuedEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // приватный режим / переполнение — очередь недоступна
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

export const queued = () => read();

/**
 * POST /api/entries; при сетевой ошибке — в очередь. Возвращает "queued" или
 * { mealId } — приём дня, в который встала запись (null — ответ не прочитался):
 * разбор текста шлёт остальные позиции в приём, созданный первой.
 * Ошибки сервера (4xx/5xx) пробрасываются: их очередь не исправит.
 */
export async function postEntry(body: Record<string, unknown>, title: string): Promise<"queued" | { mealId: string | null }> {
  const payload = { ...body, eatenAt: new Date().toISOString() };
  let res: Response;
  try {
    res = await fetch("/api/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch {
    write([...read(), { id: crypto.randomUUID(), body: payload, title, queuedAt: new Date().toISOString() }]);
    return "queued";
  }
  if (!res.ok) throw new Error(`entry failed: ${res.status}`);
  const entry = (await res.json().catch(() => null)) as { mealId?: unknown } | null;
  return { mealId: typeof entry?.mealId === "string" ? entry.mealId : null };
}

/** Отправить очередь по порядку. Сеть пропала — остановиться; 4xx — выбросить запись. */
export async function flushQueue(): Promise<number> {
  let sent = 0;
  for (const item of read()) {
    let res: Response;
    try {
      res = await fetch("/api/entries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item.body) });
    } catch {
      break;
    }
    if (res.status === 401) break; // сессия истекла — подождём входа
    if (res.ok || (res.status >= 400 && res.status < 500)) {
      write(read().filter((q) => q.id !== item.id));
      if (res.ok) sent++;
    } else {
      break; // 5xx — попробуем позже
    }
  }
  return sent;
}

/** Кэш списков для офлайна: недавние продукты, «Блюда». */
export function cacheSet(key: string, value: unknown) {
  try {
    localStorage.setItem(`calo:cache:${key}`, JSON.stringify(value));
  } catch {}
}
export function cacheGet<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(`calo:cache:${key}`);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
