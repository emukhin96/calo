// POST /api/push/subscribe: только адреса push-сервисов; больше 10 подписок — самые старые уходят.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { pushSubscriptions, user } from "@/db/schema";
import { POST } from "./route";

const me = vi.hoisted(() => ({ id: "me" }));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});
vi.mock("@/lib/api", () => ({ apiSession: async () => ({ session: { user: { ...me } }, error: null }) }));

const FCM = "https://fcm.googleapis.com/fcm/send/";

beforeAll(async () => {
  await db.insert(user).values([
    { id: "me", name: "Me", email: "me@calo.test" },
    { id: "other", name: "O", email: "o@calo.test" },
  ]);
});
beforeEach(async () => {
  me.id = "me";
  await db.delete(pushSubscriptions);
});
afterAll(async () => {
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});

async function subscribe(endpoint: string, as = "me") {
  me.id = as;
  const res = await POST(
    new Request("http://calo.test/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    }),
  );
  return res.status;
}

const endpointsOf = async (ownerId: string) =>
  (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.ownerId, ownerId))).map((r) => r.endpoint).sort();

describe("POST /api/push/subscribe", () => {
  it("адрес не push-сервиса — 400 и ничего не сохранено (иначе сервер ходил бы куда угодно)", async () => {
    for (const url of ["http://fcm.googleapis.com/fcm/send/x", "https://evil.example/hook", "https://169.254.169.254/", "https://calc-db:5432/"]) {
      expect(await subscribe(url)).toBe(400);
    }
    expect(await endpointsOf("me")).toEqual([]);
  });

  it("обход через разбор адреса (web-push видит localhost) — 400", async () => {
    const urls = [
      "https://localhost;.push.apple.com/x",
      "https://localhost'.push.apple.com/x",
      "https://localhost{.push.apple.com/x",
      "https://localhost%2e.push.apple.com/x",
      "https://web.push.apple.com./x",
      "https://wеb.push.apple.com/x", // кириллическая «е»
    ];
    for (const url of urls) expect(await subscribe(url)).toBe(400);
    expect(await endpointsOf("me")).toEqual([]);
  });

  it("FCM, Apple, Mozilla, WNS — 204", async () => {
    const urls = [
      `${FCM}a`,
      "https://web.push.apple.com/QGx8",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
    ];
    for (const url of urls) expect(await subscribe(url)).toBe(204);
    expect(await endpointsOf("me")).toEqual([...urls].sort());
  });

  it("11-я подписка вытесняет самую старую; чужие и повторная подписка того же адреса не в счёт", async () => {
    expect(await subscribe(`${FCM}other`, "other")).toBe(204);
    for (let i = 0; i < 10; i++) expect(await subscribe(`${FCM}${i}`)).toBe(204);
    expect(await subscribe(`${FCM}5`)).toBe(204); // тот же адрес — не новая подписка
    expect(await endpointsOf("me")).toHaveLength(10);

    expect(await subscribe(`${FCM}new`)).toBe(204);
    const mine = await endpointsOf("me");
    expect(mine).toHaveLength(10);
    expect(mine).toContain(`${FCM}new`);
    expect(mine).not.toContain(`${FCM}0`);
    expect(await endpointsOf("other")).toEqual([`${FCM}other`]);
  });
});
