import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDeleteAccountLink, sendLoginLink, smtpOptions } from "./mail";

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

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

/** Регистрация (адреса ещё нет) и вход существующего — с разных IP. */
const NEW = { ip: "203.0.113.1", signup: true };
const OLD = { ip: "203.0.113.2", signup: false };
const DEL = { ip: "203.0.113.3" };

describe("письма", () => {
  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({});
    vi.stubEnv("SMTP_URL", "smtp://u:p@smtp.calo.test:587");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("ссылка входа — с приветствием новичку; второе письмо сразу — 429 EMAIL_THROTTLED", async () => {
    await sendLoginLink("login@calo.test", "https://calc.test/api/auth/magic-link/verify?token=t&callbackURL=%2F", NEW);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const m = sendMail.mock.calls[0][0];
    expect(m).toMatchObject({ to: "login@calo.test", subject: "Вход в Calo" });
    expect(m.text).toContain("https://calc.test/api/auth/magic-link/verify?token=t&callbackURL=%2F");
    expect(m.text).toContain("аккаунт создастся сам");
    expect(m.html).toContain("аккаунт создастся сам");
    // В HTML ссылка экранирована.
    expect(m.html).toContain('href="https://calc.test/api/auth/magic-link/verify?token=t&amp;callbackURL=%2F"');

    await expect(sendLoginLink("login@calo.test", "https://calc.test/x", NEW)).rejects.toMatchObject({
      statusCode: 429,
      body: { code: "EMAIL_THROTTLED" },
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("удаление аккаунта: тема, «необратимо», час", async () => {
    await sendDeleteAccountLink("delete@calo.test", "https://calc.test/api/auth/delete-user/callback?token=t", DEL);
    const m = sendMail.mock.calls[0][0];
    expect(m).toMatchObject({ to: "delete@calo.test", subject: "Удаление аккаунта Calo" });
    expect(m.text).toContain("https://calc.test/api/auth/delete-user/callback?token=t");
    expect(m.text).toContain("1 час");
    expect(m.text).toContain("Восстановить их будет нельзя");
  });

  it("SMTP упал — 502 MAIL_FAILED, в логе без адреса; место освобождено, повтор сразу уходит", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    sendMail.mockRejectedValueOnce(Object.assign(new Error("auth"), { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }));
    await expect(sendLoginLink("fail@calo.test", "https://calc.test/x", OLD)).rejects.toMatchObject({
      statusCode: 502,
      body: { code: "MAIL_FAILED" },
    });
    expect(error).toHaveBeenCalledWith("[mail] письмо со ссылкой входа не отправлено: EAUTH 535 AUTH PLAIN");
    expect(String(error.mock.calls)).not.toContain("fail@calo.test");

    await sendLoginLink("fail@calo.test", "https://calc.test/y", OLD);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("без SMTP_URL — ссылка в лог: [login-link] и [delete-link] (их ищет deploy/vps/login-link.sh)", async () => {
    vi.stubEnv("SMTP_URL", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendLoginLink("nosmtp@calo.test", "https://calc.test/login", NEW);
    await sendDeleteAccountLink("nosmtp2@calo.test", "https://calc.test/delete", DEL);
    expect(log).toHaveBeenCalledWith("[login-link] nosmtp@calo.test https://calc.test/login");
    expect(log).toHaveBeenCalledWith("[delete-link] nosmtp2@calo.test https://calc.test/delete");
    expect(sendMail).not.toHaveBeenCalled();
  });

  /** mail.ts и mail-limit.ts читают окружение при импорте — модули заново. */
  async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("./mail");
  }

  it("SIGNUP=closed — новичку аккаунт не обещаем", async () => {
    const mail = await load({ SIGNUP: "closed" });
    await mail.sendLoginLink("closed@calo.test", "https://calc.test/login", OLD);
    const m = sendMail.mock.calls[0][0];
    expect(m.text).not.toContain("аккаунт создастся сам");
    expect(m.html).not.toContain("аккаунт создастся сам");
    expect(m.text).toContain("https://calc.test/login");
  });

  it("дневной лимит держит только регистрации: вход существующих и удаление — идут", async () => {
    const mail = await load({ MAIL_DAILY_LIMIT: "1" });
    await mail.sendLoginLink("first@calo.test", "https://calc.test/1", NEW);
    await expect(mail.sendLoginLink("second@calo.test", "https://calc.test/2", { ip: "203.0.113.9", signup: true })).rejects.toMatchObject({
      statusCode: 429,
      body: { code: "MAIL_DAILY_CAP" },
    });
    await mail.sendLoginLink("old@calo.test", "https://calc.test/3", OLD);
    await mail.sendDeleteAccountLink("old@calo.test", "https://calc.test/4", DEL);
    expect(sendMail.mock.calls.map(([m]) => m.to)).toEqual(["first@calo.test", "old@calo.test", "old@calo.test"]);
  });

  it("с одного IP за сутки — не больше MAIL_IP_DAILY_LIMIT: 429 MAIL_IP_DAILY_CAP", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const mail = await load({ MAIL_IP_DAILY_LIMIT: "2" });
    await mail.sendLoginLink("a@calo.test", "https://calc.test/a", OLD);
    await mail.sendDeleteAccountLink("b@calo.test", "https://calc.test/b", { ip: OLD.ip });
    await expect(mail.sendLoginLink("c@calo.test", "https://calc.test/c", OLD)).rejects.toMatchObject({
      statusCode: 429,
      body: { code: "MAIL_IP_DAILY_CAP" },
    });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
