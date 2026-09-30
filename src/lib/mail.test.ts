import { describe, expect, it } from "vitest";
import { smtpOptions } from "./mail";

describe("smtpOptions", () => {
  it("smtp:// на 587 — только после STARTTLS; логин и пароль раскодированы", () => {
    const o = smtpOptions("smtp://no-reply%40egor.am:p%40ss%3Aw%2F%D1%91@smtp.timeweb.ru:587");
    expect(o).toMatchObject({ host: "smtp.timeweb.ru", port: 587, secure: false, requireTLS: true });
    expect(o.auth).toEqual({ user: "no-reply@egor.am", pass: "p@ss:w/ё" });
  });

  it("smtps:// — TLS сразу, порт по умолчанию 465; smtp:// без порта — 587", () => {
    expect(smtpOptions("smtps://u:p@smtp.example.com")).toMatchObject({ port: 465, secure: true, requireTLS: false });
    expect(smtpOptions("smtp://u:p@smtp.example.com")).toMatchObject({ port: 587, secure: false });
  });

  it("без логина — без auth; чужая схема — ошибка", () => {
    expect(smtpOptions("smtp://relay.local:25").auth).toBeUndefined();
    expect(() => smtpOptions("https://smtp.example.com")).toThrow();
  });
});
