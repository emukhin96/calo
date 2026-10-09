import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailLimiter, type MailBlocked, type MailContext, mailLimitError, normalizeRecipient } from "./mail-limit";

const START = Date.UTC(2026, 9, 1, 12, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;

function setup({ dailyLimit = 300, ipDailyLimit = 1000 } = {}) {
  let t = START;
  const limiter = createMailLimiter({ dailyLimit, ipDailyLimit, now: () => t });
  return {
    limiter,
    tick: (ms: number) => (t += ms),
    at: (ms: number) => (t = ms),
  };
}

/** Вход существующего пользователя с IP. */
const from = (ip: string | null): MailContext => ({ ip, signup: false });
/** Регистрация: ссылка на адрес без аккаунта. */
const signup = (ip: string | null): MailContext => ({ ip, signup: true });

const ME = from("203.0.113.1");
const ATTACKER = from("198.51.100.7");

afterEach(() => vi.restoreAllMocks());

describe("normalizeRecipient", () => {
  it("регистр, пробелы, +метка; у Gmail — точки и googlemail.com", () => {
    expect(normalizeRecipient(" Me@Calo.test ")).toBe("me@calo.test");
    expect(normalizeRecipient("me+news@calo.test")).toBe("me@calo.test");
    expect(normalizeRecipient("v.ictim+1@gmail.com")).toBe("victim@gmail.com");
    expect(normalizeRecipient("V.I.C.T.I.M@GoogleMail.com")).toBe("victim@gmail.com");
  });

  it("точки вне Gmail значимы; «+» в начале и адрес без @ — как есть", () => {
    expect(normalizeRecipient("v.ictim@calo.test")).toBe("v.ictim@calo.test");
    expect(normalizeRecipient("+tag@calo.test")).toBe("+tag@calo.test");
    expect(normalizeRecipient("not-an-email")).toBe("not-an-email");
  });
});

describe("с одного IP на один адрес", () => {
  it("второе письмо раньше чем через минуту — нельзя, с точным ожиданием; другой адрес и другой IP не задеты", () => {
    const { limiter, tick } = setup();
    expect(limiter.reserve("Me@Calo.test", "login-link", ME).ok).toBe(true);
    tick(15 * SEC);
    expect(limiter.check(" me@calo.test ", "login-link", ME)).toEqual({ ok: false, reason: "throttled", retryAfterSec: 45, hourly: false });
    expect(limiter.reserve("me@calo.test", "login-link", ME).ok).toBe(false);
    expect(limiter.check("other@calo.test", "login-link", ME)).toEqual({ ok: true });
    expect(limiter.check("me@calo.test", "login-link", ATTACKER)).toEqual({ ok: true });
    tick(45 * SEC);
    expect(limiter.check("me@calo.test", "login-link", ME)).toEqual({ ok: true });
  });

  it("псевдонимы того же ящика — один счёт", () => {
    const { limiter } = setup();
    expect(limiter.reserve("victim@gmail.com", "login-link", ATTACKER).ok).toBe(true);
    for (const alias of ["victim+1@gmail.com", "v.ictim@gmail.com", "VICTIM@googlemail.com", "v.i.c.t.i.m+x@googlemail.com"]) {
      expect(limiter.check(alias, "login-link", ATTACKER)).toMatchObject({ ok: false, reason: "throttled" });
    }
    // Вне Gmail точка — другой ящик.
    expect(limiter.reserve("v.ictim@calo.test", "login-link", ATTACKER).ok).toBe(true);
    expect(limiter.check("victim@calo.test", "login-link", ATTACKER)).toEqual({ ok: true });
  });

  it("письма входа и удаления — разный счёт", () => {
    const { limiter } = setup();
    expect(limiter.reserve("me@calo.test", "login-link", ME).ok).toBe(true);
    expect(limiter.reserve("me@calo.test", "delete-link", ME).ok).toBe(true);
    expect(limiter.check("me@calo.test", "delete-link", ME)).toMatchObject({ ok: false, reason: "throttled" });
  });

  it("check ничего не записывает", () => {
    const { limiter } = setup({ ipDailyLimit: 1, dailyLimit: 1 });
    expect(limiter.check("me@calo.test", "login-link", signup("203.0.113.1")).ok).toBe(true);
    expect(limiter.check("me@calo.test", "login-link", signup("203.0.113.1")).ok).toBe(true);
    expect(limiter.reserve("me@calo.test", "login-link", signup("203.0.113.1")).ok).toBe(true);
  });

  it("не больше 5 за час: шестое — когда первое выйдет из окна", () => {
    const { limiter, tick } = setup();
    for (let i = 0; i < 5; i++) {
      expect(limiter.reserve("me@calo.test", "login-link", ME).ok).toBe(true);
      tick(2 * MIN);
    }
    // Прошло 10 минут с первого: ждать ещё 50.
    expect(limiter.check("me@calo.test", "login-link", ME)).toEqual({ ok: false, reason: "throttled", retryAfterSec: 50 * 60, hourly: true });
    tick(50 * MIN);
    expect(limiter.reserve("me@calo.test", "login-link", ME).ok).toBe(true);
  });
});

describe("на один адрес с любых IP", () => {
  it("чужой IP исчерпал свои 5 — владелец со своего IP всё равно получает письмо", () => {
    const { limiter, tick } = setup();
    for (let i = 0; i < 5; i++) {
      expect(limiter.reserve("victim@calo.test", "login-link", ATTACKER).ok).toBe(true);
      tick(MIN);
    }
    expect(limiter.check("victim@calo.test", "login-link", ATTACKER)).toMatchObject({ ok: false, reason: "throttled", hourly: true });
    expect(limiter.reserve("victim@calo.test", "login-link", ME).ok).toBe(true);
  });

  it("не больше 10 за час, как ни меняй IP; ждать — пока первое не выйдет из окна", () => {
    const { limiter, tick } = setup();
    for (let i = 0; i < 10; i++) {
      expect(limiter.reserve("victim+spam@calo.test", "login-link", from(`198.51.100.${i}`)).ok).toBe(true);
      tick(MIN);
    }
    // Первое ушло 10 минут назад.
    expect(limiter.check("victim@calo.test", "login-link", ME)).toEqual({ ok: false, reason: "throttled", retryAfterSec: 50 * 60, hourly: true });
    // Письмо удаления — свой счёт.
    expect(limiter.check("victim@calo.test", "delete-link", ME)).toEqual({ ok: true });
    tick(50 * MIN);
    expect(limiter.reserve("victim@calo.test", "login-link", ME).ok).toBe(true);
  });
});

describe("с одного IP за сутки", () => {
  it("MAIL_IP_DAILY_LIMIT на все адреса и виды; другой IP не задет; в лог один раз и без IP; в полночь UTC — снова можно", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { limiter, at } = setup({ ipDailyLimit: 3 });
    expect(limiter.reserve("a@calo.test", "login-link", ATTACKER).ok).toBe(true);
    expect(limiter.reserve("b@calo.test", "login-link", signup("198.51.100.7")).ok).toBe(true);
    expect(limiter.reserve("c@calo.test", "delete-link", ATTACKER).ok).toBe(true);
    expect(limiter.reserve("d@calo.test", "login-link", ATTACKER)).toEqual({ ok: false, reason: "ip_daily_cap" });
    expect(limiter.check("e@calo.test", "delete-link", ATTACKER)).toEqual({ ok: false, reason: "ip_daily_cap" });
    expect(limiter.reserve("d@calo.test", "login-link", ME).ok).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[mail] дневной лимит писем с одного IP исчерпан");

    at(Date.UTC(2026, 9, 2, 0, 0, 1));
    expect(limiter.reserve("d@calo.test", "login-link", ATTACKER).ok).toBe(true);
  });

  it("IP не определён — лимит на IP не действует (в лог один раз), а на адрес — действует", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { limiter } = setup({ ipDailyLimit: 1 });
    expect(limiter.reserve("a@calo.test", "login-link", from(null)).ok).toBe(true);
    expect(limiter.reserve("b@calo.test", "login-link", from(null)).ok).toBe(true);
    expect(limiter.reserve("c@calo.test", "delete-link", from(null)).ok).toBe(true);
    expect(limiter.check("a@calo.test", "login-link", from(null))).toMatchObject({ ok: false, reason: "throttled" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[mail] не удалось определить IP — лимит на IP не действует");
  });
});

describe("дневной лимит на регистрации", () => {
  it("исчерпан — новые адреса ждут до полуночи UTC, в лог один раз за сутки", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { limiter, at } = setup({ dailyLimit: 2 });
    expect(limiter.reserve("a@calo.test", "login-link", signup("203.0.113.1")).ok).toBe(true);
    expect(limiter.reserve("b@calo.test", "login-link", signup("203.0.113.2")).ok).toBe(true);
    expect(limiter.reserve("c@calo.test", "login-link", signup("203.0.113.3"))).toEqual({ ok: false, reason: "daily_cap" });
    expect(limiter.check("d@calo.test", "login-link", signup(null))).toEqual({ ok: false, reason: "daily_cap" });
    expect(warn).toHaveBeenCalledWith("[mail] дневной лимит писем на регистрацию исчерпан");
    expect(warn.mock.calls.filter(([m]) => String(m).includes("регистрацию"))).toHaveLength(1);

    at(Date.UTC(2026, 9, 2, 0, 0, 1));
    expect(limiter.reserve("c@calo.test", "login-link", signup("203.0.113.3")).ok).toBe(true);
    expect(limiter.reserve("d@calo.test", "login-link", signup("203.0.113.4")).ok).toBe(true);
    expect(limiter.check("e@calo.test", "login-link", signup("203.0.113.5"))).toEqual({ ok: false, reason: "daily_cap" });
  });

  it("вход и удаление тех, у кого аккаунт есть, им не держатся и в него не идут", () => {
    const { limiter } = setup({ dailyLimit: 1 });
    expect(limiter.reserve("new@calo.test", "login-link", signup("198.51.100.1")).ok).toBe(true);
    expect(limiter.check("new2@calo.test", "login-link", signup("198.51.100.2"))).toEqual({ ok: false, reason: "daily_cap" });
    for (let i = 0; i < 20; i++) {
      expect(limiter.reserve(`user${i}@calo.test`, "login-link", from("203.0.113.1")).ok).toBe(true);
      expect(limiter.reserve(`user${i}@calo.test`, "delete-link", from("203.0.113.1")).ok).toBe(true);
    }
  });
});

describe("release", () => {
  it("письмо не ушло — можно сразу повторить, и ни в какой счёт оно не идёт", () => {
    const { limiter } = setup({ dailyLimit: 1, ipDailyLimit: 1 });
    const slot = limiter.reserve("me@calo.test", "login-link", signup("203.0.113.1"));
    if (!slot.ok) throw new Error("ожидалось место");
    slot.release();
    slot.release(); // повторный вызов ничего не ломает
    expect(limiter.check("me@calo.test", "login-link", signup("203.0.113.1"))).toEqual({ ok: true });
    expect(limiter.reserve("other@calo.test", "login-link", signup("203.0.113.1")).ok).toBe(true);
    expect(limiter.check("third@calo.test", "login-link", signup("203.0.113.9"))).toEqual({ ok: false, reason: "daily_cap" });
    expect(limiter.check("third@calo.test", "login-link", from("203.0.113.1"))).toEqual({ ok: false, reason: "ip_daily_cap" });
  });

  it("release вчерашнего письма не добавляет места сегодня", () => {
    const { limiter, at } = setup({ dailyLimit: 1, ipDailyLimit: 1 });
    const slot = limiter.reserve("a@calo.test", "login-link", signup("203.0.113.1"));
    if (!slot.ok) throw new Error("ожидалось место");
    at(Date.UTC(2026, 9, 2, 0, 0, 1));
    expect(limiter.reserve("b@calo.test", "login-link", signup("203.0.113.1")).ok).toBe(true);
    slot.release();
    expect(limiter.check("c@calo.test", "login-link", signup("203.0.113.2"))).toEqual({ ok: false, reason: "daily_cap" });
    expect(limiter.check("c@calo.test", "login-link", from("203.0.113.1"))).toEqual({ ok: false, reason: "ip_daily_cap" });
  });
});

describe("память", () => {
  it("адреса старше часа выбрасываются при следующей отправке, счёт по IP — в полночь UTC", () => {
    const { limiter, tick, at } = setup();
    for (let i = 0; i < 50; i++) limiter.reserve(`u${i}@calo.test`, "login-link", from(`198.51.100.${i}`));
    expect(limiter.size()).toEqual({ pairs: 50, recipients: 50, ips: 50 });
    tick(61 * MIN);
    limiter.reserve("fresh@calo.test", "login-link", ME);
    expect(limiter.size()).toEqual({ pairs: 1, recipients: 1, ips: 51 });
    at(Date.UTC(2026, 9, 2, 0, 0, 1));
    limiter.reserve("fresh2@calo.test", "login-link", ME);
    expect(limiter.size()).toEqual({ pairs: 1, recipients: 1, ips: 1 });
  });

  it("отказы ничего не записывают", () => {
    const { limiter } = setup({ dailyLimit: 0 });
    for (let i = 0; i < 50; i++) limiter.reserve(`u${i}@calo.test`, "login-link", signup(`198.51.100.${i}`));
    expect(limiter.size()).toEqual({ pairs: 0, recipients: 0, ips: 0 });
  });
});

describe("mailLimitError", () => {
  const throttled = (retryAfterSec: number, hourly = false): MailBlocked => ({ ok: false, reason: "throttled", retryAfterSec, hourly });

  it("429 EMAIL_THROTTLED: секунды до минуты, дальше минуты; Retry-After", () => {
    const e = mailLimitError(throttled(45));
    expect(e.statusCode).toBe(429);
    expect(e.body).toEqual({ code: "EMAIL_THROTTLED", message: "Письмо уже отправлено. Новое можно запросить через 45 с." });
    expect(new Headers(e.headers).get("retry-after")).toBe("45");
    expect(mailLimitError(throttled(50 * 60 - 30, true)).body?.message).toBe(
      "Слишком много писем на этот адрес. Новое можно запросить через 50 мин.",
    );
  });

  it("429 MAIL_IP_DAILY_CAP — про адрес сети", () => {
    const e = mailLimitError({ ok: false, reason: "ip_daily_cap" });
    expect(e.statusCode).toBe(429);
    expect(e.body).toEqual({ code: "MAIL_IP_DAILY_CAP", message: "Слишком много писем с этого адреса сети за сутки. Попробуйте завтра." });
  });

  it("429 MAIL_DAILY_CAP — про регистрацию, без Face ID", () => {
    const e = mailLimitError({ ok: false, reason: "daily_cap" });
    expect(e.statusCode).toBe(429);
    expect(e.body).toEqual({
      code: "MAIL_DAILY_CAP",
      message: "Регистрация новых пользователей на сегодня приостановлена — слишком много запросов. Попробуйте завтра.",
    });
  });
});
