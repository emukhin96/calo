"use client";

// Мост к нативной оболочке iOS (ios/App/App/CaloNativePlugin.swift). В браузере
// всё — no-op: isNative() = false. ARCHITECTURE.md §11.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import type { NutrientVector } from "@/domain/nutrients";

type FoodSample = { id: string; title: string; eatenAt: string; nutrients: NutrientVector };
type WidgetDish = { id: string; name: string; grams: number; kcal: number };
type WidgetSummary = {
  date: string;
  kcal: number;
  norm: number | null;
  protein: number;
  proteinNorm: number | null;
  fat: number;
  carbs: number;
  updatedAt: string;
};

interface CaloNativePlugin {
  healthAvailable(): Promise<{ available: boolean }>;
  requestHealth(): Promise<{ granted: boolean }>;
  saveFood(food: FoodSample): Promise<{ saved: number }>;
  deleteFood(opts: { id: string }): Promise<void>;
  latestWeight(): Promise<{ weight: { kg: number; measuredAt: string; uuid: string } | null }>;
  setWidgetData(data: { baseURL?: string; token?: string; summary?: WidgetSummary; dishes?: WidgetDish[] }): Promise<void>;
}

const CaloNative = registerPlugin<CaloNativePlugin>("CaloNative");

export const isNative = () => Capacitor.isNativePlatform();

/** Сообщить мосту, что дневник изменился (добавили, поправили, удалили). */
export const CHANGED_EVENT = "calo:changed";
export const notifyChanged = () => window.dispatchEvent(new Event(CHANGED_EVENT));

const HEALTH_KEY = "calo:health:enabled";
const HEALTH_EVENT = "calo:health";
const SYNCED_KEY = "calo:health:synced"; // id записи → отпечаток, уже записанный в Health
const WEIGHT_KEY = "calo:health:weight"; // uuid последнего импортированного взвешивания

function local<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function setLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const health = {
  enabled: () => isNative() && local(HEALTH_KEY, false),

  async connect(): Promise<boolean> {
    if (!isNative()) return false;
    const { available } = await CaloNative.healthAvailable();
    if (!available) return false;
    const { granted } = await CaloNative.requestHealth();
    setLocal(HEALTH_KEY, granted);
    window.dispatchEvent(new Event(HEALTH_EVENT));
    return granted;
  },

  disconnect() {
    setLocal(HEALTH_KEY, false);
    window.dispatchEvent(new Event(HEALTH_EVENT));
  },

  async saveEntry(e: { id: string; title: string; eatenAt: string | Date; nutrients: NutrientVector }) {
    if (!health.enabled()) return;
    const eatenAt = typeof e.eatenAt === "string" ? e.eatenAt : e.eatenAt.toISOString();
    await CaloNative.saveFood({ id: e.id, title: e.title, eatenAt, nutrients: e.nutrients }).catch(() => {});
    const synced = local<Record<string, string>>(SYNCED_KEY, {});
    synced[e.id] = fingerprint(e.nutrients, eatenAt);
    setLocal(SYNCED_KEY, synced);
  },

  async deleteEntry(id: string) {
    if (!health.enabled()) return;
    await CaloNative.deleteFood({ id }).catch(() => {});
    const synced = local<Record<string, string>>(SYNCED_KEY, {});
    delete synced[id];
    setLocal(SYNCED_KEY, synced);
  },
};

const fingerprint = (n: NutrientVector, at: string) => `${at}|${Math.round((n.kcal ?? 0) * 10)}|${Math.round((n.protein ?? 0) * 10)}`;

type ApiEntry = { id: string; title: string; eatenAt: string; nutrients: NutrientVector };

/**
 * Синхронизация при открытии приложения и после изменений:
 * 1) виджет — токен, сводка дня, частые блюда;
 * 2) Health — новые/изменённые записи за сегодня и вчера (записанные
 *    с Mac, из виджета, из офлайн-очереди), удалённые — убрать;
 * 3) вес из Health → сервер (повтор того же замера сервер отбросит).
 */
export async function syncNative(): Promise<void> {
  if (!isNative()) return;
  const get = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

  try {
    const [{ token }, summary, recipes] = await Promise.all([
      get("/api/native/token"),
      get("/api/summary/day"),
      get("/api/recipes"),
    ]);
    const dishes: WidgetDish[] = (recipes.items as { id: string; name: string; defaultPortionG: number | null; nutrientsPer100g: NutrientVector }[])
      .slice(0, 4)
      .map((r) => {
        const grams = Math.round(r.defaultPortionG ?? 100);
        return { id: r.id, name: r.name, grams, kcal: Math.round(((r.nutrientsPer100g.kcal ?? 0) * grams) / 100) };
      });
    await CaloNative.setWidgetData({ baseURL: location.origin, token, summary, dishes });
  } catch {
    // не вошли или нет сети — виджет покажет последнее сохранённое
  }

  if (!health.enabled()) return;
  try {
    const today = (await get("/api/entries")) as { date: string; entries: ApiEntry[] };
    const yesterdayDate = new Date(`${today.date}T12:00:00Z`);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
    const yesterday = (await get(`/api/entries?date=${yesterdayDate.toISOString().slice(0, 10)}`)) as { entries: ApiEntry[] };
    const all = [...yesterday.entries, ...today.entries];
    const synced = local<Record<string, string>>(SYNCED_KEY, {});
    for (const e of all) {
      if (synced[e.id] !== fingerprint(e.nutrients, e.eatenAt)) await health.saveEntry(e);
    }
    // Удалённые за эти два дня (например, с Mac) — убрать и из Health.
    const alive = new Set(all.map((e) => e.id));
    const since = yesterdayDate.getTime() - 36 * 3600_000;
    for (const [id, fp] of Object.entries(local<Record<string, string>>(SYNCED_KEY, {}))) {
      if (!alive.has(id) && Date.parse(fp.split("|")[0]) >= since) await health.deleteEntry(id);
    }
  } catch {}

  try {
    const { weight } = await CaloNative.latestWeight();
    if (weight && weight.uuid !== local<string | null>(WEIGHT_KEY, null)) {
      const res = await fetch("/api/weight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kg: Math.round(weight.kg * 10) / 10, measuredAt: weight.measuredAt, source: "apple_health", externalId: weight.uuid }),
      });
      if (res.ok) setLocal(WEIGHT_KEY, weight.uuid);
    }
  } catch {}
}

// ─── Хуки для интерфейса: на сервере — false, в браузере — реальное значение ───

const noop = () => () => {};
/** true внутри iOS-приложения. */
export const useIsNative = () => useSyncExternalStore(noop, isNative, () => false);

const onHealth = (cb: () => void) => {
  window.addEventListener(HEALTH_EVENT, cb);
  return () => window.removeEventListener(HEALTH_EVENT, cb);
};
/** «Здоровье» подключено (флаг в localStorage). */
export const useHealthEnabled = () => useSyncExternalStore(onHealth, health.enabled, () => false);
