import { describe, expect, it } from "vitest";
import { callbackErrorText, deletedFrom, signInErrorText } from "./auth-errors";

describe("signInErrorText: ошибка «Прислать ссылку»", () => {
  it("наши коды — русский текст сервера как есть", () => {
    const throttled = "Письмо уже отправлено. Следующее можно запросить через 47 секунд.";
    expect(signInErrorText({ status: 429, code: "EMAIL_THROTTLED", message: throttled })).toBe(throttled);
    const cap = "Регистрация новых пользователей на сегодня приостановлена — слишком много запросов. Попробуйте завтра.";
    expect(signInErrorText({ status: 429, code: "MAIL_DAILY_CAP", message: cap })).toBe(cap);
    const ipCap = "Слишком много писем с этого адреса сети за сутки. Попробуйте завтра.";
    expect(signInErrorText({ status: 429, code: "MAIL_IP_DAILY_CAP", message: ipCap })).toBe(ipCap);
    const failed = "Почта не отправилась. Попробуйте ещё раз.";
    expect(signInErrorText({ status: 502, code: "MAIL_FAILED", message: failed })).toBe(failed);
  });

  it("наши коды без текста — запасной русский", () => {
    expect(signInErrorText({ status: 429, code: "EMAIL_THROTTLED" })).toMatch(/чуть позже/);
    expect(signInErrorText({ status: 429, code: "MAIL_DAILY_CAP", message: "" })).toMatch(/^Регистрация новых пользователей на сегодня приостановлена/);
    expect(signInErrorText({ status: 429, code: "MAIL_DAILY_CAP" })).not.toMatch(/Face ID/);
    expect(signInErrorText({ status: 429, code: "MAIL_IP_DAILY_CAP", message: "Too many" })).toMatch(/адреса сети за сутки/);
    expect(signInErrorText({ status: 502, code: "MAIL_FAILED", message: "Bad gateway" })).toMatch(/Не получилось отправить письмо/);
  });

  it("429 без нашего кода — ограничитель better-auth: свой текст вместо английского", () => {
    expect(signInErrorText({ status: 429, message: "Too many requests. Please try again later." })).toBe(
      "Слишком много попыток. Подождите минуту и попробуйте снова.",
    );
  });

  it("400 — про адрес; прочие английские ответы — общий текст", () => {
    expect(signInErrorText({ status: 400, code: "VALIDATION_ERROR", message: "Invalid email" })).toBe("Проверьте адрес почты.");
    expect(signInErrorText({ status: 403, code: "INVALID_ORIGIN", message: "Invalid origin" })).toBe(
      "Не получилось отправить ссылку. Попробуйте ещё раз.",
    );
    expect(signInErrorText({ status: 500 })).toBe("Не получилось отправить ссылку. Попробуйте ещё раз.");
  });

  it("код из прототипа объекта — не наш код", () => {
    expect(signInErrorText({ status: 500, code: "toString" })).toBe("Не получилось отправить ссылку. Попробуйте ещё раз.");
  });

  it("брошенная ошибка (нет сети) — про связь", () => {
    expect(signInErrorText(new TypeError("Load failed"))).toMatch(/Нет связи/);
    expect(signInErrorText(undefined)).toMatch(/Нет связи/);
    expect(signInErrorText("oops")).toMatch(/Нет связи/);
  });
});

describe("callbackErrorText: ?error= после ссылки из письма", () => {
  it("нет ошибки — null", () => {
    expect(callbackErrorText(undefined)).toBeNull();
    expect(callbackErrorText(null)).toBeNull();
    expect(callbackErrorText("")).toBeNull();
    expect(callbackErrorText([])).toBeNull();
  });

  it("ссылка устарела или использована", () => {
    expect(callbackErrorText("INVALID_TOKEN")).toBe("Ссылка устарела или уже использована — запросите новую.");
  });

  it("регистрация закрыта аварийным выключателем", () => {
    expect(callbackErrorText("new_user_signup_disabled")).toBe("Регистрация временно закрыта. Попробуйте позже.");
  });

  it("ссылка на удаление не сработала — не «аккаунт не удалён»: её могли уже открыть", () => {
    const text = callbackErrorText("DELETE_LINK_INVALID");
    expect(text).toBe("Ссылка на удаление устарела или уже использована. Если аккаунт ещё есть — запросите удаление заново в Профиле.");
    expect(text).not.toMatch(/не удалён/);
  });

  it("сбои better-auth и незнакомые коды — общий текст", () => {
    const generic = "Не получилось войти по ссылке. Запросите новую и попробуйте ещё раз.";
    for (const code of ["failed_to_create_user", "failed_to_create_session", "user_not_found", "SOMETHING_NEW", "constructor"]) {
      expect(callbackErrorText(code)).toBe(generic);
    }
  });

  it("повтор параметра — по первому значению", () => {
    expect(callbackErrorText(["INVALID_TOKEN", "user_not_found"])).toMatch(/устарела/);
  });
});

describe("deletedFrom: ?deleted=1 на /login", () => {
  it("верим только вместе с cookie от сервера", () => {
    expect(deletedFrom("1", "self")).toBe("self");
    expect(deletedFrom("1", "other")).toBe("other");
    expect(deletedFrom(["1", "0"], "self")).toBe("self");
  });

  it("одна ссылка /login?deleted=1 без cookie — ни сообщения, ни уборки", () => {
    expect(deletedFrom("1", undefined)).toBeNull();
    expect(deletedFrom("1", null)).toBeNull();
    expect(deletedFrom("1", "")).toBeNull();
    expect(deletedFrom("1", "SELF")).toBeNull();
  });

  it("cookie без ?deleted=1 — тоже ничего: адрес уже очищен, перезагрузка не повторяет", () => {
    expect(deletedFrom(undefined, "self")).toBeNull();
    expect(deletedFrom("0", "self")).toBeNull();
    expect(deletedFrom([], "other")).toBeNull();
  });
});
