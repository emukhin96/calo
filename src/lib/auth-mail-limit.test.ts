// Дневные лимиты писем через сам better-auth (auth.handler) на тестовой БД:
// MAIL_DAILY_LIMIT держит только регистрации — вход тех, у кого аккаунт есть, и удаление
// аккаунта идут; MAIL_IP_DAILY_LIMIT — все письма с одного IP (x-forwarded-for, как у
// ограничителя better-auth). Отказ — ещё в hooks.before, без строки в verification.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user, verification } from "@/db/schema";
import { auth } from "./auth";

const sendMail = vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-42";
  process.env.SMTP_URL = "smtp://u:p@smtp.calo.test:587";
  process.env.MAIL_DAILY_LIMIT = "2";
  process.env.MAIL_IP_DAILY_LIMIT = "3";
  return vi.fn();
});
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));
vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});

const BASE = "http://localhost:3000";

afterAll(async () => {
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});
beforeEach(() => {
  sendMail.mockReset().mockResolvedValue({});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const call = (url: string | URL, init: RequestInit = {}) =>
  auth.handler(new Request(typeof url === "string" ? `${BASE}/api/auth${url}` : url, { ...init, headers: { origin: BASE, ...init.headers } }));

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

const requestLink = (email: string, ip: string) =>
  post("/sign-in/magic-link", { email, callbackURL: "/", newUserCallbackURL: "/onboarding", errorCallbackURL: "/login" }, { "x-forwarded-for": ip });

const requestDelete = (cookie: string, ip: string) => post("/delete-user", { callbackURL: "/login?deleted=1" }, { cookie, "x-forwarded-for": ip });

/** Перейти по ссылке из последнего письма; cookie сессии. */
async function followLastLink(): Promise<string> {
  const text: string = sendMail.mock.calls.at(-1)![0].text;
  const res = await call(new URL(text.match(/https?:\/\/\S+/)![0]));
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const verificationCount = async () => (await db.select().from(verification)).length;
const sentTo = () => sendMail.mock.calls.map(([m]) => m.to);

describe("MAIL_DAILY_LIMIT — только регистрации", () => {
  it("третий новый адрес за сутки — 429 MAIL_DAILY_CAP без строки в verification; вход и удаление тех, кто есть, — идут", async () => {
    await db.insert(user).values({ id: "old", name: "Old", email: "old@calo.test", emailVerified: true });
    expect((await requestLink("new1@calo.test", "203.0.113.1")).status).toBe(200);
    expect((await requestLink("new2@calo.test", "203.0.113.2")).status).toBe(200);

    const before = await verificationCount();
    const res = await requestLink("new3@calo.test", "203.0.113.3");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      code: "MAIL_DAILY_CAP",
      message: "Регистрация новых пользователей на сегодня приостановлена — слишком много запросов. Попробуйте завтра.",
    });
    expect(await verificationCount()).toBe(before);

    // У кого аккаунт есть (адрес — без учёта регистра), тот входит по ссылке и просит удаление.
    expect((await requestLink("Old@calo.test", "203.0.113.4")).status).toBe(200);
    const cookie = await followLastLink();
    expect((await requestDelete(cookie, "203.0.113.4")).status).toBe(200);
    expect(sentTo()).toEqual(["new1@calo.test", "new2@calo.test", "Old@calo.test", "old@calo.test"]);
  });
});

describe("MAIL_IP_DAILY_LIMIT — с одного IP", () => {
  it("четвёртое письмо за сутки — 429 MAIL_IP_DAILY_CAP без строки в verification; с другого IP — можно; удаление — тоже в счёт", async () => {
    await db.insert(user).values(
      [1, 2, 3, 4].map((i) => ({ id: `ip-user-${i}`, name: `U${i}`, email: `ip-user-${i}@calo.test`, emailVerified: true })),
    );
    const flood = "198.51.100.7";
    for (const i of [1, 2, 3]) expect((await requestLink(`ip-user-${i}@calo.test`, flood)).status).toBe(200);

    const before = await verificationCount();
    const res = await requestLink("ip-user-4@calo.test", flood);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      code: "MAIL_IP_DAILY_CAP",
      message: "Слишком много писем с этого адреса сети за сутки. Попробуйте завтра.",
    });
    expect(await verificationCount()).toBe(before);

    expect((await requestLink("ip-user-4@calo.test", "198.51.100.8")).status).toBe(200);

    // Письмо об удалении с того же IP тоже упирается в лимит — и клиент это видит.
    const cookie = await followLastLink();
    const del = await requestDelete(cookie, flood);
    expect(del.status).toBe(429);
    expect(await del.json()).toMatchObject({ code: "MAIL_IP_DAILY_CAP" });
    expect(sendMail).toHaveBeenCalledTimes(4);
  });
});
