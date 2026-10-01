// POST /api/cron/cleanup: только с CRON_SECRET; удаляет просроченные токены и сессии, свежие не трогает.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { session, user, verification } from "@/db/schema";
import { POST } from "./route";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});

const HOUR = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const later = (ms: number) => new Date(Date.now() + ms);

beforeAll(async () => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  await db.insert(user).values({ id: "me", name: "Me", email: "me@calo.test" });
  await db.insert(verification).values([
    { id: "v-old", identifier: "hash-old", value: "{}", expiresAt: ago(HOUR) },
    { id: "v-old2", identifier: "delete-account-old", value: "me", expiresAt: ago(1000) },
    { id: "v-fresh", identifier: "hash-fresh", value: "{}", expiresAt: later(HOUR) },
  ]);
  await db.insert(session).values([
    { id: "s-old", token: "t-old", userId: "me", expiresAt: ago(HOUR), updatedAt: new Date() },
    { id: "s-fresh", token: "t-fresh", userId: "me", expiresAt: later(HOUR), updatedAt: new Date() },
  ]);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});

const call = (auth?: string) =>
  POST(new Request("http://calo.test/api/cron/cleanup", { method: "POST", headers: auth ? { authorization: auth } : {} }));

describe("POST /api/cron/cleanup", () => {
  it("без секрета или с чужим — 403, ничего не удалено", async () => {
    expect((await call()).status).toBe(403);
    expect((await call("Bearer wrong")).status).toBe(403);
    expect((await call("Bearer cron-secreX")).status).toBe(403);
    expect(await db.select().from(verification)).toHaveLength(3);
  });

  it("с секретом — удаляет просроченное, отдаёт счётчики", async () => {
    const res = await call("Bearer cron-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verifications: 2, sessions: 1 });
    expect((await db.select().from(verification)).map((v) => v.id)).toEqual(["v-fresh"]);
    expect((await db.select().from(session)).map((s) => s.id)).toEqual(["s-fresh"]);
    expect(await (await call("Bearer cron-secret")).json()).toEqual({ verifications: 0, sessions: 0 });
  });
});
