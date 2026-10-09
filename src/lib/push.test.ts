// Push: какие адреса подписок пускаем (SSRF) и рассылка разбора недели —
// параллельно, но не больше 5 сразу, с таймаутом и чисткой мёртвых подписок.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { pushSubscriptions, user } from "@/db/schema";
import { zonedTime } from "@/domain/day";
import { isPushEndpointAllowed, sendToUser, sendWeeklyDigests } from "./push";

const sendNotification = vi.hoisted(() => vi.fn());

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));
vi.mock("./week", () => ({ lastCompleteWeek: () => "2026-09-21", shouldShowWeek: async () => true }));

const FCM = "https://fcm.googleapis.com/fcm/send/";

describe("isPushEndpointAllowed", () => {
  it.each([
    `${FCM}abc:APA91b`,
    "https://web.push.apple.com/QGx8",
    "https://api.push.apple.com/3/device/x",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
    "https://fcm.googleapis.com:443/fcm/send/x", // порт https по умолчанию
  ])("пускает %s", (url) => expect(isPushEndpointAllowed(url)).toBe(true));

  // web-push соединяется по старому url.parse(): он режет имя на этих символах,
  // и запрос ушёл бы на localhost, хотя new URL() видит *.push.apple.com.
  it.each([
    "https://localhost;.push.apple.com/x",
    "https://localhost'.push.apple.com/x",
    "https://localhost{.push.apple.com/x",
    'https://localhost".push.apple.com/x',
    "https://localhost`.push.apple.com/x",
    "https://localhost\\.push.apple.com/x",
    "https://localhost%2e.push.apple.com/x",
    "https://localhost%3B.push.apple.com/x",
    "https://localhost%00.push.apple.com/x",
    "https://localhost\u0000.push.apple.com/x",
    "https://localhost\t.push.apple.com/x",
    "https:fcm.googleapis.com/fcm/send/x", // старый парсер не видит хоста — уйдёт на localhost
    "https:/fcm.googleapis.com/fcm/send/x",
    "https://web.push.apple.com./x", // точка на конце
    "https://fcm.googleapis.com./fcm/send/x",
    "https://web.push.apple.com../x",
    "https://wеb.push.apple.com/x", // кириллическая «е»
    "https://fcm.googleapis.cоm/x", // кириллическая «о»
    "https://fcm.xn--ggleapis-nbha.com/x", // punycode «fcm.gооgleapis.com»
    "https://fcm.googleapis.xn--cm-fmc/x",
    "https://[::1]/x",
  ])("не пускает обход через разбор адреса: %j", (url) => expect(isPushEndpointAllowed(url)).toBe(false));

  it.each([
    "http://fcm.googleapis.com/fcm/send/x", // не https
    "https://fcm.googleapis.com:8443/fcm/send/x", // чужой порт
    "https://user:pw@fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilfcm.googleapis.com/x",
    "https://push.apple.com.evil.example/x",
    "https://evil-push.apple.com.example/x",
    "https://notify.windows.com.evil.example/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "https://calc-db:5432/",
    "not a url",
    "",
  ])("не пускает %s", (url) => expect(isPushEndpointAllowed(url)).toBe(false));
});

/** Понедельник 28.09.2026, 10:00 по Москве — окно напоминаний. */
const MONDAY_MORNING = zonedTime("2026-09-28", 10, 0, "Europe/Moscow");

beforeAll(async () => {
  vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  await db.insert(user).values([
    { id: "a", name: "A", email: "a@calo.test" },
    { id: "b", name: "B", email: "b@calo.test" },
  ]);
});
beforeEach(async () => {
  sendNotification.mockReset();
  await db.delete(pushSubscriptions);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});

const sub = (ownerId: string, endpoint: string) => ({ ownerId, endpoint, p256dh: "p", auth: "a" });

describe("sendWeeklyDigests", () => {
  it("не больше 5 отправок сразу; 410 — подписка удалена; отправленным — неделя отмечена", async () => {
    const subs = Array.from({ length: 12 }, (_, i) => sub(i % 2 ? "a" : "b", `${FCM}${i}`));
    await db.insert(pushSubscriptions).values([...subs, sub("a", "https://evil.example/hook")]);

    let inFlight = 0;
    let maxInFlight = 0;
    sendNotification.mockImplementation(async ({ endpoint }: { endpoint: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (endpoint === `${FCM}3`) throw Object.assign(new Error("gone"), { statusCode: 410 });
      return { statusCode: 201 };
    });

    expect(await sendWeeklyDigests(MONDAY_MORNING)).toEqual({ checked: 13, sent: 11 });
    expect(maxInFlight).toBe(5);
    // Адрес не из списка push-сервисов — запроса туда нет вовсе.
    expect(sendNotification.mock.calls.map(([s]) => s.endpoint)).not.toContain("https://evil.example/hook");
    expect(sendNotification.mock.calls[0][2]).toMatchObject({ timeout: 10_000 });

    const rows = await db.select().from(pushSubscriptions);
    expect(rows.find((r) => r.endpoint === `${FCM}3`)).toBeUndefined();
    expect(rows.filter((r) => r.lastWeekNotified === "2026-09-21")).toHaveLength(11);

    // Повторный запуск в тот же час — никому второй раз.
    sendNotification.mockClear();
    expect(await sendWeeklyDigests(MONDAY_MORNING)).toEqual({ checked: 12, sent: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("вне окна понедельника — ничего не шлёт", async () => {
    await db.insert(pushSubscriptions).values(sub("a", `${FCM}x`));
    const tuesday = zonedTime("2026-09-29", 10, 0, "Europe/Moscow");
    expect(await sendWeeklyDigests(tuesday)).toEqual({ checked: 1, sent: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("sendToUser", () => {
  it("шлёт на все свои устройства с таймаутом; чужие не трогает", async () => {
    await db.insert(pushSubscriptions).values([sub("a", `${FCM}1`), sub("a", `${FCM}2`), sub("b", `${FCM}3`)]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
    expect(await sendToUser("a", { title: "t", body: "b", url: "/" })).toBe(2);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    for (const call of sendNotification.mock.calls) expect(call[2]).toMatchObject({ timeout: 10_000 });
  });

  it("сохранённый адрес-обход (localhost;.push.apple.com) — запроса нет", async () => {
    await db.insert(pushSubscriptions).values([sub("a", "https://localhost;.push.apple.com/x"), sub("a", `${FCM}1`)]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
    expect(await sendToUser("a", { title: "t", body: "b", url: "/" })).toBe(1);
    expect(sendNotification.mock.calls.map(([s]) => s.endpoint)).toEqual([`${FCM}1`]);
  });

  it("404 — подписка удалена", async () => {
    await db.insert(pushSubscriptions).values(sub("a", `${FCM}1`));
    sendNotification.mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }));
    expect(await sendToUser("a", { title: "t", body: "b", url: "/" })).toBe(0);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.ownerId, "a"))).toHaveLength(0);
  });
});
