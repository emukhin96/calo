// SIGNUP=closed: аварийно закрытая регистрация — новый адрес по ссылке не входит
// (/login?error=new_user_signup_disabled), а тот, кто уже есть, входит как обычно;
// в письме аккаунт новичку не обещан.
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "./auth";

const sendMail = vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-42";
  process.env.SMTP_URL = "smtp://u:p@smtp.calo.test:587";
  process.env.SIGNUP = "closed";
  return vi.fn(async () => ({}));
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

/** Запросить ссылку и перейти по ней; куда отправили. */
async function signIn(email: string) {
  const res = await auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { origin: BASE, "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/", newUserCallbackURL: "/onboarding", errorCallbackURL: "/login" }),
    }),
  );
  expect(res.status).toBe(200);
  const calls = sendMail.mock.calls as unknown as [{ text: string }][];
  const link = calls.at(-1)![0].text.match(/https?:\/\/\S+/)![0];
  return (await auth.handler(new Request(link))).headers.get("location");
}

describe("SIGNUP=closed", () => {
  it("новый адрес — на /login?error=new_user_signup_disabled, пользователь не создан; в письме — без «аккаунт создастся сам»", async () => {
    expect(await signIn("stranger@calo.test")).toBe(`${BASE}/login?error=new_user_signup_disabled`);
    expect(await db.select().from(user)).toEqual([]);
    const calls = sendMail.mock.calls as unknown as [{ text: string; html: string }][];
    expect(calls.at(-1)![0].text).not.toContain("аккаунт создастся сам");
    expect(calls.at(-1)![0].html).not.toContain("аккаунт создастся сам");
  });

  it("существующий — входит", async () => {
    await db.insert(user).values({ id: "old", name: "Old", email: "old@calo.test", emailVerified: true });
    expect(await signIn("old@calo.test")).toBe(`${BASE}/`);
  });
});
