import { describe, expect, it } from "vitest";
import { addHref, kcalStatus, remaining, weekStrip } from "./diary-view";

const RANGE: [number, number] = [2200, 2700];

describe("kcalStatus", () => {
  it("ниже, в коридоре и выше коридора нормы", () => {
    expect(kcalStatus(1500, RANGE)).toBe("below");
    expect(kcalStatus(2200, RANGE)).toBe("ok");
    expect(kcalStatus(2700, RANGE)).toBe("ok");
    expect(kcalStatus(2701, RANGE)).toBe("above");
  });
});

describe("weekStrip", () => {
  // 2026-09-30 — среда; неделя 28 сентября – 4 октября.
  it("неделя с понедельника: выбранный день, сегодня, будущие дни и точки", () => {
    const { days } = weekStrip("2026-09-29", "2026-09-30", { "2026-09-28": 2400, "2026-09-29": 3000, "2026-09-30": 800 }, RANGE);
    expect(days.map((d) => d.date)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(days.map((d) => d.weekday)).toEqual(["пн", "вт", "ср", "чт", "пт", "сб", "вс"]);
    expect(days.map((d) => d.day)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(days.filter((d) => d.selected).map((d) => d.date)).toEqual(["2026-09-29"]);
    expect(days.filter((d) => d.today).map((d) => d.date)).toEqual(["2026-09-30"]);
    expect(days.filter((d) => d.future).map((d) => d.day)).toEqual([1, 2, 3, 4]);
    expect(days.map((d) => d.status)).toEqual(["ok", "above", "below", null, null, null, null]);
  });

  it("день с записями без калорий — серая точка; день без записей — без точки", () => {
    const { days } = weekStrip("2026-09-30", "2026-09-30", { "2026-09-30": 0 }, RANGE);
    expect(days[2].status).toBe("below");
    expect(days[1].status).toBeNull();
  });

  it("стрелки: назад — на неделю раньше; вперёд — не позже сегодня, в будущую неделю — нельзя", () => {
    expect(weekStrip("2026-09-30", "2026-09-30", {}, RANGE)).toMatchObject({ prev: "2026-09-23", next: null });
    // Прошлая неделя, среда → эта неделя, среда (сегодня).
    expect(weekStrip("2026-09-23", "2026-09-30", {}, RANGE)).toMatchObject({ prev: "2026-09-16", next: "2026-09-30" });
    // Прошлая неделя, пятница → в этой неделе пятница ещё впереди — сегодня.
    expect(weekStrip("2026-09-25", "2026-09-30", {}, RANGE).next).toBe("2026-09-30");
    // Две недели назад — ровно на неделю вперёд.
    expect(weekStrip("2026-09-18", "2026-09-30", {}, RANGE).next).toBe("2026-09-25");
  });

  it("неделя через границу месяца и года", () => {
    const { days } = weekStrip("2026-01-01", "2026-01-10", {}, RANGE);
    expect(days[0].date).toBe("2025-12-29");
    expect(days.map((d) => d.day)).toEqual([29, 30, 31, 1, 2, 3, 4]);
  });
});

describe("remaining", () => {
  it("осталось, коридор нормы и сверх нормы", () => {
    expect(remaining(1640, 2450, RANGE)).toBe("осталось 810 ккал");
    expect(remaining(2300, 2450, RANGE)).toBe("осталось 150 ккал · в коридоре нормы");
    expect(remaining(2500, 2450, RANGE)).toBe("в коридоре нормы · +50 ккал");
    expect(remaining(3000, 2450, RANGE)).toBe("сверх нормы 550 ккал");
  });
});

describe("addHref", () => {
  it("день, приём дня по id, приём по названию, текст", () => {
    expect(addHref("2026-09-30")).toBe("/add?d=2026-09-30");
    const id = "0b6f3c2e-8a51-4d7e-9c1f-2a3b4c5d6e7f";
    expect(addHref("2026-09-30", { meal: id })).toBe(`/add?d=2026-09-30&meal=${id}`);
    expect(addHref("2026-09-30", { meal: "Ужин" })).toBe("/add?d=2026-09-30&meal=%D0%A3%D0%B6%D0%B8%D0%BD");
    expect(addHref("2026-09-30", { text: "творог 180, кофе & чай" })).toBe(
      `/add?d=2026-09-30&text=${encodeURIComponent("творог 180, кофе & чай")}`,
    );
    // Пустые значения — без параметров; времени (&t=) больше нет.
    expect(addHref("2026-09-30", { meal: "", text: "" })).toBe("/add?d=2026-09-30");
    expect(addHref("2026-09-30", { meal: "Обед" })).not.toContain("&t=");
  });

  it("параметры читаются обратно как были", () => {
    const q = new URL(addHref("2026-09-30", { meal: "Второй завтрак", text: "кефир 250 + банан" }), "http://x").searchParams;
    expect(q.get("d")).toBe("2026-09-30");
    expect(q.get("meal")).toBe("Второй завтрак");
    expect(q.get("text")).toBe("кефир 250 + банан");
    expect(q.has("t")).toBe(false);
  });
});
