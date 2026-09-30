// GET / PUT /api/profile/meals: свой список приёмов со скрытыми и старые клиенты с plan.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { saveProfile } from "@/db/profile";
import { user } from "@/db/schema";
import { GET, PUT } from "./route";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});
vi.mock("@/lib/api", () => ({ apiSession: async () => ({ session: { user: { id: "me" } }, error: null }) }));

const DEFAULT = ["Завтрак", "Обед", "Ужин", "Перекус"];

beforeAll(async () => {
  await db.insert(user).values({ id: "me", name: "Me", email: "me@calo.test" });
});
afterAll(async () => {
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});

const put = async (body: unknown) => {
  const res = await PUT(
    new Request("http://calo.test/api/profile/meals", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
};
const get = async () => (await GET(new Request("http://calo.test/api/profile/meals"))).json();

describe("/api/profile/meals", () => {
  it("до онбординга: по умолчанию, сохранить нельзя (409)", async () => {
    expect(await get()).toEqual({ plan: DEFAULT, items: DEFAULT.map((name) => ({ name, hidden: false })), showTimes: false });
    expect((await put({ showTimes: true })).status).toBe(409);
  });

  it("items: весь список со скрытыми; plan — только видимые", async () => {
    await saveProfile(db, "me", { sex: "male", birthYear: 1990, heightCm: 180, activity: "light", timezone: "Europe/Moscow" });
    const r = await put({
      items: [{ name: " завтрак" }, { name: "Второй завтрак", hidden: true }, { name: "Обед", hidden: false }, { name: "", hidden: true }, { name: "перекус", hidden: true }],
      showTimes: true,
    });
    const items = [
      { name: "Завтрак", hidden: false },
      { name: "Второй завтрак", hidden: true },
      { name: "Обед", hidden: false },
      { name: "Перекус", hidden: true },
    ];
    expect(r).toEqual({ status: 200, json: { plan: ["Завтрак", "Обед"], items, showTimes: true } });
    expect(await get()).toEqual({ plan: ["Завтрак", "Обед"], items, showTimes: true });
  });

  it("старые клиенты: { plan } — все видны", async () => {
    const r = await put({ plan: ["Завтрак", "обед", "Ужин"] });
    expect(r.json).toEqual({
      plan: ["Завтрак", "Обед", "Ужин"],
      items: ["Завтрак", "Обед", "Ужин"].map((name) => ({ name, hidden: false })),
      showTimes: true,
    });
  });

  it("неверное тело — 400: всё скрыто, пусто, больше 12, items вместе с plan", async () => {
    for (const body of [
      {},
      { items: [] },
      { items: [{ name: "Обед", hidden: true }] },
      { items: [{ name: "  " }] },
      { items: Array(13).fill({ name: "Полдник" }) },
      { items: [{ name: "Обед" }], plan: ["Обед"] },
      { items: ["Обед"] },
      { plan: [" "] },
      { showTimes: "yes" },
    ]) {
      expect((await put(body)).status).toBe(400);
    }
    expect((await get()).plan).toEqual(["Завтрак", "Обед", "Ужин"]);
  });
});
