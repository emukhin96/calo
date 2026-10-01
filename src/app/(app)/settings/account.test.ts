import { describe, expect, it } from "vitest";
import { deleteAccountErrorText, deleteLinkFrom, deleteStateAfterError, unsentWarning } from "./account";

describe("unsentWarning", () => {
  it("пустая очередь — без предупреждения", () => {
    expect(unsentWarning(0)).toBeNull();
  });

  it("число и согласование", () => {
    expect(unsentWarning(1)).toBe("1 запись ещё не отправлена — при выходе она пропадёт.");
    expect(unsentWarning(3)).toBe("3 записи ещё не отправлены — при выходе они пропадут.");
    expect(unsentWarning(5)).toBe("5 записей ещё не отправлены — при выходе они пропадут.");
    expect(unsentWarning(21)).toBe("21 запись ещё не отправлена — при выходе она пропадёт.");
  });
});

describe("deleteAccountErrorText", () => {
  it("русский текст нашего сервера показываем как есть", () => {
    const message = "Письмо уже отправлено. Следующее можно запросить через 2 минуты.";
    expect(deleteAccountErrorText({ status: 429, code: "EMAIL_THROTTLED", message })).toBe(message);
    expect(deleteAccountErrorText({ status: 502, code: "MAIL_FAILED", message: "Почта не ответила" })).toBe("Почта не ответила");
  });

  it("английский от better-auth — свой текст", () => {
    expect(deleteAccountErrorText({ status: 429, message: "Too many requests. Please try again later." })).toMatch(/Подождите минуту/);
    expect(deleteAccountErrorText({ status: 401, code: "UNAUTHORIZED", message: "Unauthorized" })).toMatch(/Войдите заново/);
    expect(deleteAccountErrorText({ status: 500, message: "Internal Server Error" })).toMatch(/Не получилось отправить письмо/);
  });

  it("нет ответа сервера (вызов бросил) — про связь", () => {
    expect(deleteAccountErrorText(new TypeError("Failed to fetch"))).toMatch(/Нет связи/);
    expect(deleteAccountErrorText(null)).toMatch(/Нет связи/);
  });
});

describe("deleteStateAfterError", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const minutesAgo = (m: number) => now - m * 60_000;
  const throttled = { status: 429, code: "EMAIL_THROTTLED", message: "Письмо уже отправлено. Новое можно запросить через 40 с." };

  it("сервер говорит, что письмо уже ушло, — к полю для ссылки, даже если отправляли не отсюда", () => {
    expect(deleteStateAfterError(throttled, null, now)).toBe("sent");
    expect(deleteStateAfterError(throttled, minutesAgo(1), now)).toBe("sent");
  });

  it("другой 429 — к полю, только если сами отправили письмо меньше часа назад", () => {
    const ipLimit = { status: 429, message: "Too many requests. Please try again later." };
    const dailyCap = { status: 429, code: "MAIL_DAILY_CAP", message: "Лимит писем на сегодня исчерпан. Попробуйте позже." };
    expect(deleteStateAfterError(ipLimit, minutesAgo(5), now)).toBe("sent");
    expect(deleteStateAfterError(dailyCap, minutesAgo(59), now)).toBe("sent");
    expect(deleteStateAfterError(dailyCap, minutesAgo(61), now)).toBe("confirm");
    expect(deleteStateAfterError(ipLimit, null, now)).toBe("confirm");
  });

  it("не 429 — снова «Удалить аккаунт?» с кнопкой повтора", () => {
    expect(deleteStateAfterError({ status: 502, code: "MAIL_FAILED", message: "Почта не ответила" }, minutesAgo(1), now)).toBe("confirm");
    expect(deleteStateAfterError(new TypeError("Failed to fetch"), minutesAgo(1), now)).toBe("confirm");
    expect(deleteStateAfterError(null, minutesAgo(1), now)).toBe("confirm");
  });
});

describe("deleteLinkFrom", () => {
  const origin = "https://calc.egor.am";
  const link = `${origin}/api/auth/delete-user/callback?token=abc123&callbackURL=%2Flogin%3Fdeleted%3D1`;

  it("наша ссылка из письма — переходим по ней (пробелы по краям не мешают)", () => {
    expect(deleteLinkFrom(`  ${link}\n`, origin)).toBe(link);
    const page = `${origin}/delete-account?token=abc123`;
    expect(deleteLinkFrom(page, origin)).toBe(page);
    expect(deleteLinkFrom(`${origin}/delete-account`, origin)).toBeNull();
  });

  it("чужой сайт, другой путь, без токена, не ссылка — нет", () => {
    expect(deleteLinkFrom(link.replace(origin, "https://evil.example"), origin)).toBeNull();
    expect(deleteLinkFrom(`${origin}/api/auth/magic-link/verify?token=abc`, origin)).toBeNull();
    expect(deleteLinkFrom(`${origin}/api/auth/delete-user/callback`, origin)).toBeNull();
    expect(deleteLinkFrom("удалить аккаунт", origin)).toBeNull();
  });
});
