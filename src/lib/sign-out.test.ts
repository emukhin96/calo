import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocalUserState, signOutAndClear } from "./sign-out";

// Окружение тестов — node: localStorage, caches, service worker и window — заглушки.
const { signOut, clearNativeState } = vi.hoisted(() => ({ signOut: vi.fn(), clearNativeState: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut } }));
vi.mock("@/lib/native", () => ({ clearNativeState }));

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  keys() {
    return [...this.m.keys()].sort();
  }
}

let storage: MemoryStorage;
let cacheNames: string[];
let calls: string[];
let unsubscribe: ReturnType<typeof vi.fn>;
let dispatchEvent: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

function stubBrowser({ subscribed = true } = {}) {
  storage = new MemoryStorage();
  for (const k of ["calo:queue:v1", "calo:cache:recent", "calo:health:enabled", "calo:health:synced", "calo:health:weight", "other-app"]) {
    storage.setItem(k, "1");
  }
  cacheNames = ["calo-v2-static", "calo-v2-pages", "workbox-precache"];
  calls = [];
  unsubscribe = vi.fn(async () => {
    calls.push("unsubscribe");
    return true;
  });
  const sub = subscribed ? { endpoint: "https://web.push.apple.com/abc", unsubscribe } : null;
  dispatchEvent = vi.fn();
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { dispatchEvent });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("caches", {
    keys: async () => [...cacheNames],
    delete: async (name: string) => {
      cacheNames = cacheNames.filter((n) => n !== name);
      return true;
    },
  });
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) },
  });
  signOut.mockImplementation(async () => {
    calls.push("signOut");
    return { data: { success: true }, error: null };
  });
  clearNativeState.mockImplementation(async () => {
    calls.push("native");
  });
}

beforeEach(() => stubBrowser());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("clearLocalUserState", () => {
  it("стирает только наше: ключи calo:*, кэши calo-*, push этого браузера, виджет", async () => {
    await clearLocalUserState();
    expect(storage.keys()).toEqual(["other-app"]);
    expect(cacheNames).toEqual(["workbox-precache"]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(clearNativeState).toHaveBeenCalledOnce();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "calo:queue" }));
    expect(fetchMock).not.toHaveBeenCalled(); // с сервером не говорит
    expect(signOut).not.toHaveBeenCalled();
  });

  it("не бросает, когда чего-то нет или что-то падает", async () => {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("SecurityError");
      },
    });
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal("navigator", {});
    clearNativeState.mockRejectedValue(new Error("UNIMPLEMENTED"));
    await expect(clearLocalUserState()).resolves.toBeUndefined();
  });

  it("без подписки на push — просто убирает остальное", async () => {
    stubBrowser({ subscribed: false });
    await clearLocalUserState();
    expect(storage.keys()).toEqual(["other-app"]);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});

describe("signOutAndClear", () => {
  it("сначала отвязывает push на сервере (пока вошли), потом выход, потом уборка", async () => {
    await signOutAndClear();
    expect(fetchMock).toHaveBeenCalledWith("/api/push/subscribe", expect.objectContaining({ method: "DELETE" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ endpoint: "https://web.push.apple.com/abc" });
    expect(calls.slice(0, 2)).toEqual(["DELETE /api/push/subscribe", "signOut"]);
    expect(calls).toContain("unsubscribe");
    expect(calls).toContain("native");
    expect(storage.keys()).toEqual(["other-app"]);
  });

  it("без подписки на push сервер про неё не спрашивает", async () => {
    stubBrowser({ subscribed: false });
    await signOutAndClear();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("push не отвязался (нет сети) — выход всё равно идёт", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await signOutAndClear();
    expect(signOut).toHaveBeenCalledOnce();
    expect(storage.keys()).toEqual(["other-app"]);
  });

  it("сервер выход не подтвердил — бросает и ничего не стирает", async () => {
    signOut.mockResolvedValue({ data: null, error: { status: 500 } });
    await expect(signOutAndClear()).rejects.toThrow();
    expect(storage.getItem("calo:queue:v1")).toBe("1");
    expect(cacheNames).toContain("calo-v2-pages");
    expect(clearNativeState).not.toHaveBeenCalled();
  });

  it("нет сети при выходе — бросает и ничего не стирает", async () => {
    signOut.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(signOutAndClear()).rejects.toThrow();
    expect(storage.getItem("calo:health:enabled")).toBe("1");
  });
});
