// POST /api/parse/text: личный и общий дневные лимиты ИИ на тестовой БД; владелец — вне общего.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";
import { POST } from "./route";

const me = vi.hoisted(() => ({ id: "u1", email: "u1@calo.test" }));
const generateJson = vi.hoisted(() => vi.fn(async () => ({ items: [] })));

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});
vi.mock("@/lib/api", () => ({ apiSession: async () => ({ session: { user: { ...me } }, error: null }) }));
vi.mock("@/lib/tz", () => ({ userTimeZone: async () => "Europe/Moscow" }));
vi.mock("@/lib/env", () => ({ isOwnerEmail: (e: string) => e === "owner@calo.test" }));
vi.mock("@/ai/gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai/gemini")>()),
  aiEnabled: () => true,
  generateJson,
}));

const USERS = ["u1", "u2", "u3", "owner"];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("AI_DAILY_LIMIT", "1");
  vi.stubEnv("AI_GLOBAL_DAILY_LIMIT", "2");
  await db.insert(user).values(USERS.map((id) => ({ id, name: id, email: `${id}@calo.test` })));
});
afterEach(() => generateJson.mockClear());
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});

/** Текст без количеств — fastParse не справится, нужен ИИ. */
async function parseAs(id: string) {
  Object.assign(me, { id, email: `${id}@calo.test` });
  const res = await POST(
    new Request("http://calo.test/api/parse/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "тарелка борща и кусок хлеба" }),
    }),
  );
  return { status: res.status, json: await res.json() };
}

describe("POST /api/parse/text: лимиты ИИ", () => {
  it("отказ по личному лимиту не тратит общий; общий исчерпан — 429, владелец проходит", async () => {
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    expect((await parseAs("u1")).status).toBe(200);

    // u1 упёрся в личный лимит и долбит дальше — общий счётчик не растёт.
    for (let i = 0; i < 3; i++) {
      const r = await parseAs("u1");
      expect(r.status).toBe(429);
      expect(r.json.error).toMatch(/Дневной лимит/);
    }

    expect((await parseAs("u2")).status).toBe(200); // 2 из 2 общих
    const r3 = await parseAs("u3");
    expect(r3.status).toBe(429);
    expect(r3.json.error).toMatch(/перегружен/);

    const owner = await parseAs("owner");
    expect(owner.status).toBe(200);
    expect(owner.json.source).toBe("ai");

    expect(generateJson).toHaveBeenCalledTimes(3); // u1, u2, владелец
  });

  it("новые сутки UTC — общий лимит снова свободен", async () => {
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    expect((await parseAs("u3")).status).toBe(200);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});
