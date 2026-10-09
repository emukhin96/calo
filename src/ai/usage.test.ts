import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { takeAiRequest, takeGlobalAiRequest } from "./usage";

let db: DB;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: "u1", name: "U", email: "u@calo.test" });
});
afterAll(() => close());

describe("takeAiRequest", () => {
  it("пускает до лимита включительно, дальше — нет; другой день считается отдельно", async () => {
    expect(await takeAiRequest(db, "u1", "2026-09-30", 2)).toBe(true);
    expect(await takeAiRequest(db, "u1", "2026-09-30", 2)).toBe(true);
    expect(await takeAiRequest(db, "u1", "2026-09-30", 2)).toBe(false);
    expect(await takeAiRequest(db, "u1", "2026-10-01", 2)).toBe(true);
  });
});

describe("takeGlobalAiRequest", () => {
  const at = (iso: string) => new Date(iso);

  it("общий лимит на сутки UTC: до лимита включительно, отказы счётчик не растят", async () => {
    const now = at("2026-09-20T12:00:00Z");
    expect(await takeGlobalAiRequest(db, now, 2)).toBe(true);
    expect(await takeGlobalAiRequest(db, now, 2)).toBe(true);
    for (let i = 0; i < 5; i++) expect(await takeGlobalAiRequest(db, now, 2)).toBe(false);
    // Лимит подняли — сразу есть место: отказы выше не накопились в счётчике.
    expect(await takeGlobalAiRequest(db, now, 3)).toBe(true);
    expect(await takeGlobalAiRequest(db, now, 3)).toBe(false);
  });

  it("день — по UTC: 23:59Z и 00:01Z — разные сутки, хотя в Москве это одно утро", async () => {
    expect(await takeGlobalAiRequest(db, at("2026-09-21T23:59:00Z"), 1)).toBe(true);
    expect(await takeGlobalAiRequest(db, at("2026-09-21T23:59:30Z"), 1)).toBe(false);
    expect(await takeGlobalAiRequest(db, at("2026-09-22T00:01:00Z"), 1)).toBe(true);
  });

  it("удаление аккаунта не обнуляет общий счётчик (в отличие от ai_usage)", async () => {
    const now = at("2026-09-23T12:00:00Z");
    await db.insert(user).values({ id: "gone", name: "G", email: "gone@calo.test" });
    expect(await takeAiRequest(db, "gone", "2026-09-23", 60)).toBe(true);
    expect(await takeGlobalAiRequest(db, now, 1)).toBe(true);
    await db.delete(user).where(eq(user.id, "gone"));
    expect(await takeGlobalAiRequest(db, now, 1)).toBe(false);
  });
});
