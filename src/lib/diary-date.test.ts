import { describe, expect, it } from "vitest";
import { zonedTime } from "@/domain/day";
import { diaryDateOf, newEntryTiming } from "./diary-date";

const TZ = "Europe/Moscow";
/** 30 сентября, 18:00 по Москве. */
const now = zonedTime("2026-09-30", 18, 0, TZ);
const ctx = { tz: TZ, now };
const msk = (date: string, h: number, m = 0) => zonedTime(date, h, m, TZ);

describe("diaryDateOf: день из ?d=", () => {
  it("прошлый день и сегодня — как есть, будущий и мусор — сегодня", () => {
    const today = "2026-09-30";
    expect(diaryDateOf("2026-09-29", today)).toBe("2026-09-29");
    expect(diaryDateOf(today, today)).toBe(today);
    expect(diaryDateOf("2026-10-01", today)).toBe(today);
    expect(diaryDateOf("2027-01-01", today)).toBe(today);
    expect(diaryDateOf("2026-9-1", today)).toBe(today);
    expect(diaryDateOf("вчера", today)).toBe(today);
    expect(diaryDateOf(undefined, today)).toBe(today);
    expect(diaryDateOf(["2026-09-29"], today)).toBe(today);
  });
});

describe("newEntryTiming: день и время новой записи", () => {
  it("прошлый день и сегодня — дата и время как прислали", () => {
    const eatenAt = msk("2026-09-30", 17, 55).toISOString();
    expect(newEntryTiming({ date: "2026-09-28", time: "08:30", eatenAt }, ctx)).toEqual({
      date: "2026-09-28",
      time: "08:30",
      eatenAt: new Date(eatenAt),
    });
    expect(newEntryTiming({}, ctx)).toEqual({ date: undefined, time: undefined, eatenAt: null });
  });

  it("будущий день — сегодня, время «HH:MM» с телефона отброшено", () => {
    // Телефон в Токио: там уже 1 октября, 00:05; момент тот же, что у сервера.
    const eatenAt = new Date(now.getTime() - 5 * 60_000).toISOString();
    expect(newEntryTiming({ date: "2026-10-01", time: "00:05", eatenAt }, ctx)).toEqual({
      date: "2026-09-30",
      eatenAt: new Date(eatenAt),
    });
    expect(newEntryTiming({ date: "2027-01-01" }, ctx)).toEqual({ date: "2026-09-30", eatenAt: null });
  });

  it("будущий день с mealId — дату решает приём (не 400 и не потерянная запись)", () => {
    const mealId = "7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
    expect(newEntryTiming({ date: "2026-10-01", mealId }, ctx)).toEqual({ date: undefined, eatenAt: null });
    expect(newEntryTiming({ date: "2026-09-29", mealId }, ctx)).toEqual({ date: "2026-09-29", eatenAt: null });
  });

  it("eatenAt в будущем дне не берётся — и с датой, и без неё", () => {
    // 00:30 1 октября по Москве: в пределах двух суток, но день ещё не наступил.
    const tomorrow = msk("2026-10-01", 0, 30).toISOString();
    expect(newEntryTiming({ date: "2026-10-01", eatenAt: tomorrow }, ctx).eatenAt).toBeNull();
    // Без date день выбирался бы по eatenAt — был бы завтрашний.
    expect(newEntryTiming({ eatenAt: tomorrow }, ctx)).toEqual({ date: undefined, time: undefined, eatenAt: null });
  });

  it("eatenAt дальше двух суток от «сейчас» — не берётся", () => {
    expect(newEntryTiming({ eatenAt: msk("2026-09-28", 17, 0).toISOString() }, ctx).eatenAt).toBeNull();
    expect(newEntryTiming({ eatenAt: msk("2026-09-28", 19, 0).toISOString() }, ctx).eatenAt).toEqual(msk("2026-09-28", 19, 0));
  });
});
