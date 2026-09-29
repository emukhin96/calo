import { describe, expect, it } from "vitest";
import { addDays, dayRange, dayTitle, eatenAtFor, isIsoDate, isValidTimeZone, mealByHour, todayIn, zonedTime } from "./day";

describe("dayRange", () => {
  it("Москва: сутки начинаются в 21:00 UTC накануне", () => {
    const { start, end } = dayRange("2026-09-29", "Europe/Moscow");
    expect(start.toISOString()).toBe("2026-09-28T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-29T21:00:00.000Z");
  });

  it("Ереван (+4)", () => {
    expect(dayRange("2026-09-29", "Asia/Yerevan").start.toISOString()).toBe("2026-09-28T20:00:00.000Z");
  });

  it("переход на зимнее время: день длиннее на час", () => {
    const { start, end } = dayRange("2026-10-25", "Europe/Berlin");
    expect((end.getTime() - start.getTime()) / 3600000).toBe(25);
    expect(start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });
});

describe("todayIn / zonedTime", () => {
  it("поздний вечер по UTC — уже завтра в Москве", () => {
    expect(todayIn("Europe/Moscow", new Date("2026-09-29T22:30:00Z"))).toBe("2026-09-30");
  });

  it("местное время → UTC", () => {
    expect(zonedTime("2026-09-29", 8, 30, "Europe/Moscow").toISOString()).toBe("2026-09-29T05:30:00.000Z");
  });
});

describe("mealByHour", () => {
  it.each([
    [7, "breakfast"], [12, "lunch"], [16, "snack"], [17, "snack"], [19, "dinner"], [23, "snack"], [3, "snack"],
  ] as const)("%i ч → %s", (h, meal) => {
    expect(mealByHour(h)).toBe(meal);
  });
});

describe("eatenAtFor", () => {
  const now = new Date("2026-09-29T10:00:00Z"); // 13:00 в Москве

  it("сегодня — текущий момент", () => {
    expect(eatenAtFor("2026-09-29", "breakfast", "Europe/Moscow", now)).toBe(now);
  });

  it("вчера — типичное время приёма", () => {
    expect(eatenAtFor("2026-09-28", "dinner", "Europe/Moscow", now).toISOString()).toBe("2026-09-28T16:30:00.000Z");
  });
});

describe("разное", () => {
  it("addDays через границу месяца и года", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("isIsoDate / isValidTimeZone", () => {
    expect(isIsoDate("2026-09-29")).toBe(true);
    expect(isIsoDate("2026-13-45")).toBe(false);
    expect(isIsoDate("29.09.2026")).toBe(false);
    expect(isValidTimeZone("Asia/Yerevan")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("dayTitle", () => {
    const now = new Date("2026-09-29T10:00:00Z");
    expect(dayTitle("2026-09-29", "Europe/Moscow", now)).toBe("Сегодня");
    expect(dayTitle("2026-09-28", "Europe/Moscow", now)).toBe("Вчера");
    expect(dayTitle("2026-09-26", "Europe/Moscow", now)).toBe("суббота, 26 сентября");
  });
});
