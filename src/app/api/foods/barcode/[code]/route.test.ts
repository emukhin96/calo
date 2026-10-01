// GET /api/foods/barcode/:code — сканер находит сначала свой продукт, а выбор из
// поиска в Open Food Facts (?source=off) — именно товар OFF.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { createOwnFood } from "@/db/foods";
import { user } from "@/db/schema";
import { aiEnabled, generateJson } from "@/ai/gemini";
import { getFood } from "@/db/foods";
import { fetchOffProduct } from "@/lib/off";
import { GET } from "./route";

vi.mock("@/db", async () => {
  const { createTestDb } = await import("@/test/db");
  return createTestDb();
});
vi.mock("@/lib/api", () => ({ apiSession: async () => ({ session: { user: { id: "me" } }, error: null }) }));
vi.mock("@/lib/off", () => ({ fetchOffProduct: vi.fn() }));
vi.mock("@/lib/tz", () => ({ userTimeZone: async () => "Asia/Yerevan" }));
vi.mock("@/ai/gemini", async (orig) => ({ ...(await orig<typeof import("@/ai/gemini")>()), aiEnabled: vi.fn(() => false), generateJson: vi.fn() }));
// after() вне запроса Next не работает: выполняем сразу и ждём в тесте.
const later: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => later.push(fn()) }));

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

describe("один товар — любое написание кода", () => {
  it("свой продукт с UPC-A из 12 цифр находится и по 13 цифрам с нулём", async () => {
    await createOwnFood(db, "me", { nameRu: "Йогурт Natrel", barcode: "068100058925", nutrientsPer100g: { kcal: 70 } });
    expect((await get("", "0068100058925")).json).toMatchObject({ nameRu: "Йогурт Natrel", own: true, sourceRef: "0068100058925" });
    expect((await get("", "068100058925")).json).toMatchObject({ nameRu: "Йогурт Natrel", own: true });
    expect(off).not.toHaveBeenCalled();
  });

  it("повторное сохранение под другим написанием — тот же продукт, не копия", async () => {
    const first = await createOwnFood(db, "me", { nameRu: "Сыр", barcode: "042100005264", nutrientsPer100g: { kcal: 300 } });
    const second = await createOwnFood(db, "me", { nameRu: "Сыр Лори", barcode: "0042100005264", nutrientsPer100g: { kcal: 310 } });
    expect(second.id).toBe(first.id);
    expect((await get("", "042100005264")).json).toMatchObject({ nameRu: "Сыр Лори" });
  });

  it("восьмизначный UPC-E: если OFF не знает его как EAN-8 — развёрнутый UPC-A", async () => {
    off.mockReset();
    off.mockImplementation(async (c: string) =>
      c === "0012000003455" ? { source: "off", sourceRef: "0012000003455", nameRu: "Жвачка", nutrientsPer100g: { kcal: 0 } } : null,
    );
    const r = await get("?source=off", "01234505");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ nameRu: "Жвачка", sourceRef: "0012000003455" });
    expect(off).toHaveBeenNthCalledWith(1, "01234505");
    expect(off).toHaveBeenNthCalledWith(2, "0012000003455");
  });
});

describe("название не по-русски", () => {
  it("переводится после ответа; новое обновление из OFF его не затирает", async () => {
    vi.mocked(aiEnabled).mockReturnValue(true);
    vi.mocked(generateJson).mockResolvedValue({ nameRu: "Сыр Лори рассольный", aliases: ["сыр лори"] });
    off.mockReset();
    off.mockResolvedValue({ source: "off", sourceRef: "4850001262640", nameRu: "Lori brine cheese", brand: "Marianna", nutrientsPer100g: { kcal: 340 } });

    const first = await get("", "4850001262640");
    expect(first.json).toMatchObject({ nameRu: "Lori brine cheese" }); // ответ не ждёт ИИ
    await Promise.all(later);
    const renamed = await getFood(db, "me", first.json.id);
    expect(renamed?.nameRu).toBe("Сыр Лори рассольный");

    later.length = 0;
    const again = await get("", "4850001262640");
    expect(again.json).toMatchObject({ id: first.json.id, nameRu: "Сыр Лори рассольный" });
    expect(later).toHaveLength(0); // уже по-русски — ИИ не зовём
    vi.mocked(aiEnabled).mockReturnValue(false);
  });
});

