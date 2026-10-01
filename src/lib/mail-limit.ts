import "server-only";
import { APIError } from "better-auth/api";

/**
 * Лимиты писем: вход открыт всем, и форма входа не должна стать рассыльщиком, а
 * чужой человек — оставлять другого без входа. Правила (на вид письма отдельно, кроме IP):
 * - с одного IP на один адрес — не чаще раза в минуту и не больше 5 в час;
 * - на один адрес с любых IP — не больше 10 в час: ящик не завалят и сменой IP;
 *   один чужой IP займёт из них не больше 5; с двух и больше IP лимит адреса можно
 *   выбрать, и вход по почте на этот адрес подождёт до часа (Face ID на вебе — нет);
 * - с одного IP на все адреса и виды — MAIL_IP_DAILY_LIMIT за сутки UTC;
 * - регистрации (ссылка входа на адрес без аккаунта) — MAIL_DAILY_LIMIT на всех за
 *   сутки UTC: у почтового ящика свой лимит, и бан за спам ударит по всем. Письма
 *   тем, у кого аккаунт уже есть, этот лимит не считает и не держит — поток
 *   случайных адресов не запрёт вход и удаление аккаунта.
 * Адрес для счёта приводится к одному виду (normalizeRecipient); письмо уходит на введённый.
 *
 * В памяти процесса: контейнер один, а после перезапуска счёт с нуля не страшен.
 * Пишутся только отправки, поэтому память ограничена: окна по адресам — за последний
 * час, счёт по IP — за сутки, а писем больше не бывает, чем регистраций за сутки
 * плюс по 20 в час на каждый существующий аккаунт.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** С одного IP на один адрес за час. */
const PER_PAIR_HOUR = 5;
/** На один адрес с любых IP за час. */
const PER_RECIPIENT_HOUR = 10;

/** Вид письма. Удаление аккаунта просят и сразу после входа — письмо входа не должно ему мешать. */
export type MailKind = "login-link" | "delete-link";

/**
 * Откуда и какое письмо: ip — клиента, как его видит ограничитель better-auth (null —
 * не определён), signup — ссылка входа на адрес, у которого аккаунта ещё нет.
 */
export type MailContext = { ip: string | null; signup: boolean };

export type MailBlocked =
  | { ok: false; reason: "throttled"; retryAfterSec: number; hourly: boolean }
  | { ok: false; reason: "ip_daily_cap" }
  | { ok: false; reason: "daily_cap" };
export type MailCheck = { ok: true } | MailBlocked;
/** Место под письмо: release() — если отправить не вышло, чтобы можно было повторить сразу. */
export type MailReservation = { ok: true; release: () => void } | MailBlocked;

/**
 * Адрес для счёта: без регистра и пробелов, без «+метки», у Gmail — без точек и
 * googlemail.com = gmail.com. Иначе victim+1@gmail.com и v.ictim@gmail.com обходили
 * бы лимит на адрес, а письма приходили бы в тот же ящик.
 */
export function normalizeRecipient(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

export function createMailLimiter({
  dailyLimit,
  ipDailyLimit,
  now = () => Date.now(),
}: {
  dailyLimit: number;
  ipDailyLimit: number;
  now?: () => number;
}) {
  /** «вид|IP|адрес» → время отправок за последний час. */
  const byPair = new Map<string, number[]>();
  /** «вид|адрес» → время отправок за последний час, с любых IP. */
  const byRecipient = new Map<string, number[]>();
  /** IP → писем за текущие сутки UTC. */
  const byIp = new Map<string, number>();
  let day = "";
  let signups = 0;
  /** Что уже записано в лог за эти сутки — чтобы не засыпать лог при наплыве. */
  const loggedToday = new Set<string>();
  let noIpLogged = false;

  function rollDay(t: number) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d === day) return;
    day = d;
    signups = 0;
    byIp.clear();
    loggedToday.clear();
  }

  function warnOnceToday(message: string) {
    if (loggedToday.has(message)) return;
    loggedToday.add(message);
    console.warn(message);
  }

  /** Отправки по ключу за последний час; пустые записи удаляются. */
  function recent(map: Map<string, number[]>, k: string, t: number): number[] {
    const list = (map.get(k) ?? []).filter((x) => t - x < HOUR);
    if (list.length) map.set(k, list);
    else map.delete(k);
    return list;
  }

  function prune(map: Map<string, number[]>, t: number) {
    for (const [k, list] of map) if (t - list[list.length - 1] >= HOUR) map.delete(k);
  }

  function drop(map: Map<string, number[]>, k: string, t: number) {
    const list = map.get(k) ?? [];
    const i = list.indexOf(t);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) map.delete(k);
  }

  const throttled = (ms: number, hourly: boolean): MailBlocked => ({
    ok: false,
    reason: "throttled",
    retryAfterSec: Math.max(1, Math.ceil(ms / 1000)),
    hourly,
  });

  /** IP не определён — один общий «?»: тогда правило «IP + адрес» работает как лимит на адрес. */
  function keys(email: string, kind: MailKind, ip: string | null) {
    const to = normalizeRecipient(email);
    return { pair: `${kind}|${ip ?? "?"}|${to}`, recipient: `${kind}|${to}` };
  }

  function checkAt(k: ReturnType<typeof keys>, ctx: MailContext, t: number): MailCheck {
    rollDay(t);
    const pair = recent(byPair, k.pair, t);
    const last = pair[pair.length - 1];
    if (last !== undefined && t - last < MINUTE) return throttled(last + MINUTE - t, false);
    if (pair.length >= PER_PAIR_HOUR) return throttled(pair[0] + HOUR - t, true);
    const recipient = recent(byRecipient, k.recipient, t);
    if (recipient.length >= PER_RECIPIENT_HOUR) return throttled(recipient[0] + HOUR - t, true);
    if (ctx.ip === null) {
      if (!noIpLogged) console.warn("[mail] не удалось определить IP — лимит на IP не действует");
      noIpLogged = true;
    } else if ((byIp.get(ctx.ip) ?? 0) >= ipDailyLimit) {
      warnOnceToday("[mail] дневной лимит писем с одного IP исчерпан");
      return { ok: false, reason: "ip_daily_cap" };
    }
    if (ctx.signup && signups >= dailyLimit) {
      warnOnceToday("[mail] дневной лимит писем на регистрацию исчерпан");
      return { ok: false, reason: "daily_cap" };
    }
    return { ok: true };
  }

  /** Можно ли сейчас отправить письмо. Ничего не записывает. */
  const check = (email: string, kind: MailKind, ctx: MailContext): MailCheck => checkAt(keys(email, kind, ctx.ip), ctx, now());

  /** Занять место под письмо прямо перед отправкой. */
  function reserve(email: string, kind: MailKind, ctx: MailContext): MailReservation {
    const t = now();
    const k = keys(email, kind, ctx.ip);
    const r = checkAt(k, ctx, t);
    if (!r.ok) return r;
    const reservedDay = day;
    byPair.set(k.pair, [...(byPair.get(k.pair) ?? []), t]);
    byRecipient.set(k.recipient, [...(byRecipient.get(k.recipient) ?? []), t]);
    if (ctx.ip !== null) byIp.set(ctx.ip, (byIp.get(ctx.ip) ?? 0) + 1);
    if (ctx.signup) signups++;
    prune(byPair, t);
    prune(byRecipient, t);
    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        drop(byPair, k.pair, t);
        drop(byRecipient, k.recipient, t);
        // Суточные счётчики — только если сутки те же: вчерашнее письмо места сегодня не освобождает.
        rollDay(now());
        if (day !== reservedDay) return;
        if (ctx.ip !== null) {
          const n = (byIp.get(ctx.ip) ?? 0) - 1;
          if (n > 0) byIp.set(ctx.ip, n);
          else byIp.delete(ctx.ip);
        }
        if (ctx.signup && signups > 0) signups--;
      },
    };
  }

  return { check, reserve, size: () => ({ pairs: byPair.size, recipients: byRecipient.size, ips: byIp.size }) };
}

export const mailLimiter = createMailLimiter({
  dailyLimit: Number(process.env.MAIL_DAILY_LIMIT) || 300,
  ipDailyLimit: Number(process.env.MAIL_IP_DAILY_LIMIT) || 30,
});

const wait = (sec: number) => (sec <= 60 ? `${sec} с` : `${Math.ceil(sec / 60)} мин`);

/**
 * Ошибка для клиента: 429 с кодом, чтобы экран отличил её от общего лимита
 * better-auth по IP (тот без кода и по-английски).
 */
export function mailLimitError(r: MailBlocked): APIError {
  if (r.reason === "daily_cap") {
    return new APIError("TOO_MANY_REQUESTS", {
      code: "MAIL_DAILY_CAP",
      message: "Регистрация новых пользователей на сегодня приостановлена — слишком много запросов. Попробуйте завтра.",
    });
  }
  if (r.reason === "ip_daily_cap") {
    return new APIError("TOO_MANY_REQUESTS", {
      code: "MAIL_IP_DAILY_CAP",
      message: "Слишком много писем с этого адреса сети за сутки. Попробуйте завтра.",
    });
  }
  return new APIError(
    "TOO_MANY_REQUESTS",
    {
      code: "EMAIL_THROTTLED",
      message: r.hourly
        ? `Слишком много писем на этот адрес. Новое можно запросить через ${wait(r.retryAfterSec)}.`
        : `Письмо уже отправлено. Новое можно запросить через ${wait(r.retryAfterSec)}.`,
    },
    { "Retry-After": String(r.retryAfterSec) },
  );
}
