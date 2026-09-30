// GET /api/foods/barcode/:code — сканер находит сначала свой продукт, а выбор из
// поиска в Open Food Facts (?source=off) — именно товар OFF.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { createOwnFood } from "@/db/foods";
import { user } from "@/db/schema";
import { fetchOffProduct } from "@/lib/off";
import { GET } from "./route";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});
vi.mock("@/lib/api", () => ({ apiSession: async () => ({ session: { user: { id: "me" } }, error: null }) }));
vi.mock("@/lib/off", () => ({ fetchOffProduct: vi.fn() }));

const CODE = "4600000000017";
const off = vi.mocked(fetchOffProduct);

async function get(query = "", code = CODE) {
  const res = await GET(new Request(`http://calo.test/api/foods/barcode/${code}${query}`), {
    params: Promise.resolve({ code }),
  });
  return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
  await db.insert(user).values({ id: "me", name: "Me", email: "me@calo.test" });
  await createOwnFood(db, "me", { nameRu: "Мой йогурт", barcode: CODE, nutrientsPer100g: { kcal: 60 } });
});
afterAll(async () => {
  await ((await import("@/db")) as unknown as { close: () => Promise<void> }).close();
});
beforeEach(() => {
  off.mockReset();
  off.mockResolvedValue({ source: "off", sourceRef: CODE, nameRu: "Йогурт из OFF", nutrientsPer100g: { kcal: 80 } });
});

describe("GET /api/foods/barcode/:code", () => {
  it("сканер: свой продукт с этим штрихкодом — раньше OFF", async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ nameRu: "Мой йогурт", own: true, sourceRef: CODE });
    expect(off).not.toHaveBeenCalled();
  });

  it("?source=off — выбранный в поиске товар OFF, свой продукт его не подменяет", async () => {
    const r = await get("?source=off");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ nameRu: "Йогурт из OFF", source: "off", own: false });
    expect(off).toHaveBeenCalledWith(CODE);
  });

  it("?source=off: OFF не ответил — сохранённый товар OFF, а не свой; нет и его — 404 / 502", async () => {
    off.mockRejectedValueOnce(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await get("?source=off")).json).toMatchObject({ nameRu: "Йогурт из OFF", own: false });

    const other = "4600000000024";
    await createOwnFood(db, "me", { nameRu: "Только свой", barcode: other, nutrientsPer100g: { kcal: 1 } });
    off.mockResolvedValueOnce(null);
    expect((await get("?source=off", other)).status).toBe(404);
    off.mockRejectedValueOnce(new Error("timeout"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await get("?source=off", other)).status).toBe(502);
    // без параметра этот же код — свой продукт
    expect((await get("", other)).json).toMatchObject({ nameRu: "Только свой", own: true });
  });

  it("другой source — как без параметра", async () => {
    expect((await get("?source=own")).json).toMatchObject({ nameRu: "Мой йогурт" });
  });
});
