import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { user } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { takeAiRequest } from "./usage";

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
