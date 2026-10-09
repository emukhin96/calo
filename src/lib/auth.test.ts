// Регистрация и удаление аккаунта через сам better-auth (auth.handler) на тестовой БД:
// hooks.before (длина полей, лимит писем) не оставляет строк в verification, новый
// пользователь получает имя = адрес, удаление по ссылке из письма работает без сессии.
// Дневные лимиты писем (на IP и на регистрации) — в auth-mail-limit.test.ts.
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dayMeals, entries, foods, profiles, recipeIngredients, recipes, user, verification } from "@/db/schema";
import { auth } from "./auth";

const sendMail = vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-42";
  process.env.SMTP_URL = "smtp://u:p@smtp.calo.test:587";
  // Без x-forwarded-for getIP в тестах даёт всем 127.0.0.1 — суточный лимит на IP здесь не мешает.
  process.env.MAIL_IP_DAILY_LIMIT = "1000";
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
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** path — от /api/auth или ссылка из письма целиком. */
const call = (path: string | URL, init: RequestInit = {}) =>
  auth.handler(
    new Request(typeof path === "string" ? `${BASE}/api/auth${path}` : path, { ...init, headers: { origin: BASE, ...init.headers } }),
  );

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

const requestLink = (email: string, extra: Record<string, unknown> = {}) =>
  post("/sign-in/magic-link", { email, callbackURL: "/", newUserCallbackURL: "/onboarding", errorCallbackURL: "/login", ...extra });

/** Ссылка из последнего письма. */
function lastLink(): URL {
  const text: string = sendMail.mock.calls.at(-1)![0].text;
  return new URL(text.match(/https?:\/\/\S+/)![0]);
}

/**
 * Письмо об удалении ведёт на страницу подтверждения (src/app/delete-account), а её
 * кнопка — на /delete-user/callback с тем же токеном. Возвращает адрес кнопки.
 */
function deleteConfirmLink(): URL {
  const page = lastLink();
  expect(page.pathname).toBe("/delete-account");
  const token = page.searchParams.get("token");
  expect(token).toBeTruthy();
  return new URL(`${BASE}/api/auth/delete-user/callback?token=${encodeURIComponent(token!)}`);
}

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

const verificationCount = async () => (await db.select().from(verification)).length;

/** Set-Cookie calo.deleted из ответа или undefined. */
const deletedCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("calo.deleted="));

/** Вход по ссылке: новый пользователь, его id и cookie сессии. */
async function signUp(email: string) {
  expect((await requestLink(email)).status).toBe(200);
  const link = lastLink();
  const res = await call(link);
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { res, link, id: u?.id, cookie: cookieOf(res) };
}

describe("POST /sign-in/magic-link", () => {
  it("имя длиннее 100 или адрес длиннее 254 — 400, строк в verification нет", async () => {
    const before = await verificationCount();
    expect((await requestLink("long-name@calo.test", { name: "я".repeat(101) })).status).toBe(400);
    expect((await requestLink(`${"a".repeat(250)}@calo.test`)).status).toBe(400);
    expect((await requestLink("long-cb@calo.test", { callbackURL: `/${"x".repeat(300)}` })).status).toBe(400);
    expect(await verificationCount()).toBe(before);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("второй запрос сразу — 429 EMAIL_THROTTLED по-русски, без новой строки в verification", async () => {
    expect((await requestLink("throttle@calo.test")).status).toBe(200);
    const before = await verificationCount();
    const res = await requestLink("Throttle@calo.test");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("EMAIL_THROTTLED");
    expect(body.message).toMatch(/^Письмо уже отправлено\. Новое можно запросить через \d+ с\.$/);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await verificationCount()).toBe(before);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("лимит на адрес — с каждого IP свой: чужой IP не запирает вход владельцу", async () => {
    const attacker = { "x-forwarded-for": "198.51.100.7" };
    const owner = { "x-forwarded-for": "203.0.113.1" };
    const link = (headers: Record<string, string>) =>
      post("/sign-in/magic-link", { email: "victim@calo.test", callbackURL: "/", errorCallbackURL: "/login" }, headers);
    expect((await link(attacker)).status).toBe(200);
    expect((await link(attacker)).status).toBe(429);
    expect((await link(owner)).status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("IPv6 — по сети /64, как у ограничителя better-auth", async () => {
    const from = (ip: string) =>
      post("/sign-in/magic-link", { email: "v6@calo.test", callbackURL: "/", errorCallbackURL: "/login" }, { "x-forwarded-for": ip });
    expect((await from("2001:db8:1:2::1")).status).toBe(200);
    expect((await from("2001:db8:1:2:aaaa::ffff")).status).toBe(429);
    expect((await from("2001:db8:1:3::1")).status).toBe(200);
  });

  it("псевдоним того же ящика — тот же лимит", async () => {
    expect((await requestLink("alias.user@gmail.com")).status).toBe(200);
    const before = await verificationCount();
    const res = await requestLink("aliasuser+calo@googlemail.com");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "EMAIL_THROTTLED" });
    expect(await verificationCount()).toBe(before);
  });

  it("SMTP упал — 502 MAIL_FAILED; повторить можно сразу", async () => {
    sendMail.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "ECONNECTION" }));
    const res = await requestLink("smtp-down@calo.test");
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "MAIL_FAILED" });
    expect((await requestLink("smtp-down@calo.test")).status).toBe(200);
  });
});

describe("регистрация по ссылке", () => {
  it("новый адрес → пользователь с именем = адрес, на /onboarding; токен в базе только хешем", async () => {
    const { res, link, id } = await signUp("new@calo.test");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/onboarding`);
    expect(id).toBeTruthy();
    const [u] = await db.select().from(user).where(eq(user.email, "new@calo.test"));
    expect(u).toMatchObject({ name: "new@calo.test", emailVerified: true });
    const token = link.searchParams.get("token")!;
    expect(await db.select().from(verification).where(eq(verification.identifier, token))).toEqual([]);
  });

  it("ссылка второй раз — на /login?error=INVALID_TOKEN", async () => {
    const { link } = await signUp("twice@calo.test");
    const res = await call(link);
    expect(res.headers.get("location")).toBe(`${BASE}/login?error=INVALID_TOKEN`);
  });
});

describe("удаление аккаунта", () => {
  async function requestDelete(cookie: string) {
    return post("/delete-user", { callbackURL: "/login?deleted=1" }, { cookie });
  }

  it("письмо → ссылка в другом браузере (без сессии) → всё удалено, на /login?deleted=1; повтор ссылки — DELETE_LINK_INVALID", async () => {
    const { id, cookie } = await signUp("bye@calo.test");
    // Данные во всех видах: свой продукт в своём рецепте, приём пищи с записью, профиль.
    const [food] = await db
      .insert(foods)
      .values({ ownerId: id, nameRu: "Мой хлеб", source: "manual", nutrientsPer100g: { kcal: 250 } })
      .returning();
    const [recipe] = await db
      .insert(recipes)
      .values({ ownerId: id, name: "Бутерброд", kind: "composite", nutrientsPer100g: { kcal: 250 } })
      .returning();
    await db.insert(recipeIngredients).values({ recipeId: recipe.id, foodId: food.id, grams: 50 });
    const [m] = await db.insert(dayMeals).values({ ownerId: id, date: "2026-10-01", name: "Завтрак", position: 1 }).returning();
    await db.insert(entries).values({
      ownerId: id,
      mealId: m.id,
      eatenAt: new Date(),
      meal: "breakfast",
      inputMethod: "recipe",
      title: "Бутерброд",
      foodId: food.id,
      recipeId: recipe.id,
      grams: 100,
      nutrients: { kcal: 250 },
    });
    await db.insert(profiles).values({ ownerId: id, sex: "male", birthYear: 1990, heightCm: 180, activity: "light" });

    const res = await requestDelete(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Verification email sent" });
    const mail = sendMail.mock.calls.at(-1)![0];
    expect(mail).toMatchObject({ to: "bye@calo.test", subject: "Удаление аккаунта Calo" });
    const link = deleteConfirmLink();

    const done = await call(link, { headers: {} });
    expect(done.status).toBe(302);
    expect(done.headers.get("location")).toBe(`${BASE}/login?deleted=1`);
    // Входа в этом браузере нет — только сообщение, без уборки; cookie короткая и только для /login.
    const flag = deletedCookie(done);
    expect(flag).toMatch(/^calo\.deleted=other;/);
    expect(flag).toMatch(/; Max-Age=120(;|$)/);
    expect(flag).toMatch(/; Path=\/login(;|$)/);
    expect(flag).toMatch(/; HttpOnly(;|$)/);
    expect(flag).toMatch(/; SameSite=Lax(;|$)/);
    expect(flag).not.toMatch(/Secure/); // http://localhost
    expect(await db.select().from(user).where(eq(user.id, id!))).toEqual([]);
    expect(await db.select().from(foods).where(eq(foods.ownerId, id!))).toEqual([]);
    expect(await db.select().from(recipes).where(eq(recipes.ownerId, id!))).toEqual([]);
    expect(await db.select().from(entries).where(eq(entries.ownerId, id!))).toEqual([]);
    expect(await db.select().from(profiles).where(eq(profiles.ownerId, id!))).toEqual([]);

    const again = await call(link);
    expect(again.headers.get("location")).toBe(`${BASE}/login?error=DELETE_LINK_INVALID`);
    expect(deletedCookie(again)).toBeUndefined();
  });

  it("ссылка в том же браузере — cookie сессии стираются", async () => {
    const { id, cookie } = await signUp("same@calo.test");
    expect((await requestDelete(cookie)).status).toBe(200);
    const link = deleteConfirmLink();
    const done = await call(link, { headers: { cookie } });
    expect(done.headers.get("location")).toBe(`${BASE}/login?deleted=1`);
    expect(done.headers.getSetCookie().some((c) => c.startsWith("better-auth.session_token=;") && /Max-Age=0/i.test(c))).toBe(true);
    expect(deletedCookie(done)).toMatch(/^calo\.deleted=self;/);
    expect(await db.select().from(user).where(eq(user.id, id!))).toEqual([]);
  });

  it("ссылка, открытая под другим пользователем, удаляет владельца ссылки, а чужую сессию не трогает", async () => {
    const owner = await signUp("owner-of-link@calo.test");
    const other = await signUp("other-user@calo.test");
    expect((await requestDelete(owner.cookie)).status).toBe(200);
    const link = deleteConfirmLink();
    const done = await call(link, { headers: { cookie: other.cookie } });
    expect(done.headers.get("location")).toBe(`${BASE}/login?deleted=1`);
    expect(done.headers.getSetCookie().some((c) => /Max-Age=0/i.test(c))).toBe(false);
    // Здесь вошёл другой: /login покажет «удалено», но его данные на устройстве не тронет.
    expect(deletedCookie(done)).toMatch(/^calo\.deleted=other;/);
    expect(await db.select().from(user).where(eq(user.id, owner.id!))).toEqual([]);
    expect(await db.select().from(user).where(eq(user.id, other.id!))).toHaveLength(1);
  });

  it("неизвестный или пустой токен — /login?error=DELETE_LINK_INVALID, никого не удалили", async () => {
    const users = (await db.select().from(user)).length;
    for (const q of ["?token=nope&callbackURL=%2Flogin%3Fdeleted%3D1", ""]) {
      const res = await call(`/delete-user/callback${q}`);
      expect(res.headers.get("location")).toBe(`${BASE}/login?error=DELETE_LINK_INVALID`);
      expect(deletedCookie(res)).toBeUndefined();
    }
    expect((await db.select().from(user)).length).toBe(users);
  });

  it("письмо не ушло — клиент получает 502 MAIL_FAILED, а не «письмо отправлено»", async () => {
    const { cookie } = await signUp("delete-smtp@calo.test");
    sendMail.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "ECONNECTION" }));
    const res = await requestDelete(cookie);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "MAIL_FAILED" });
  });

  it("сразу после входа — можно; повторный запрос сразу — 429 EMAIL_THROTTLED", async () => {
    // Письмо входа ушло только что — письму удаления оно не мешает, а второе письмо удаления ждёт.
    const { cookie } = await signUp("delete-twice@calo.test");
    expect((await requestDelete(cookie)).status).toBe(200);
    const res = await requestDelete(cookie);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "EMAIL_THROTTLED" });
  });

  it("без сессии запросить удаление нельзя — 401", async () => {
    expect((await requestDelete("")).status).toBe(401);
  });
});
