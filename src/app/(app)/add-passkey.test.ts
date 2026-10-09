import { describe, expect, it } from "vitest";
import { addPasskeyErrorText } from "./add-passkey";

describe("addPasskeyErrorText", () => {
  it("закрыли окно Face ID — молчим", () => {
    // Так @better-auth/passkey возвращает отмену: NotAllowedError и AbortError от @simplewebauthn/browser.
    const notAllowed = { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", message: "The operation either timed out or was not allowed.", status: 400 };
    expect(addPasskeyErrorText(notAllowed)).toBeNull();
    expect(addPasskeyErrorText({ code: "ERROR_CEREMONY_ABORTED", message: "Registration cancelled", status: 400 })).toBeNull();
  });

  it("сессия не свежая — войти заново", () => {
    expect(addPasskeyErrorText({ code: "SESSION_NOT_FRESH" })).toMatch(/войдите заново/);
  });

  it("остальное и нет ответа — общий текст", () => {
    const generic = /Не получилось включить Face ID/;
    expect(addPasskeyErrorText({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toMatch(generic);
    expect(addPasskeyErrorText({ code: "UNKNOWN_ERROR" })).toMatch(generic);
    expect(addPasskeyErrorText({})).toMatch(generic);
    expect(addPasskeyErrorText(null)).toMatch(generic);
  });
});
