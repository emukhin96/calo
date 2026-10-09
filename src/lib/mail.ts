import "server-only";
import { APIError } from "better-auth/api";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { signupClosed } from "./env";
import { type MailContext, type MailKind, mailLimiter, mailLimitError } from "./mail-limit";

/**
 * Настройки SMTP из SMTP_URL: smtp://логин:пароль@smtp.timeweb.ru:587 (логин и
 * пароль — в процентной кодировке, scripts/set-smtp.command так и пишет). У
 * Hetzner исходящие 25 и 465 закрыты, поэтому smtp:// на 587 (запасной у
 * Timeweb — 2525) — и тогда только после STARTTLS: пароль не уйдёт открытым
 * текстом. smtps:// — TLS сразу (465 по умолчанию). Тайм-ауты короткие: вход по
 * ссылке не должен висеть минутами, если почта не отвечает.
 */
export function smtpOptions(smtpUrl: string): SMTPTransport.Options {
  const u = new URL(smtpUrl);
  const secure = u.protocol === "smtps:";
  if (!secure && u.protocol !== "smtp:") throw new Error(`SMTP_URL: неизвестная схема ${u.protocol}`);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : secure ? 465 : 587,
    secure,
    requireTLS: !secure,
    auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const button = (href: string, label: string, color: string) =>
  `<p><a href="${href}" style="display:inline-block;padding:12px 22px;border-radius:14px;background:${color};color:#ffffff;text-decoration:none;font-weight:bold">${label}</a></p>`;

type Letter = {
  /** Метка в логе ([login-link] ищет deploy/vps/login-link.sh) и счёт лимита. */
  tag: MailKind;
  /** Для строки [mail] в логе: «письмо <what> не отправлено». */
  what: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Отправка с лимитами (mail-limit.ts). SMTP_URL и MAIL_FROM задаются в .env на
 * сервере (scripts/set-smtp.command). Пока SMTP не настроен, ссылка пишется в лог
 * контейнера. Лимиты действуют и тогда — локально видно то же, что в проде.
 */
async function send(email: string, url: string, letter: Letter, ctx: MailContext): Promise<void> {
  const slot = mailLimiter.reserve(email, letter.tag, ctx);
  if (!slot.ok) throw mailLimitError(slot);
  const smtp = process.env.SMTP_URL;
  if (!smtp) {
    console.log(`[${letter.tag}] ${email} ${url}`);
    return;
  }
  try {
    await nodemailer.createTransport(smtpOptions(smtp)).sendMail({
      from: process.env.MAIL_FROM || "Calo <no-reply@egor.am>",
      to: email,
      subject: letter.subject,
      text: letter.text,
      html: letter.html,
    });
  } catch (e) {
    // Письмо не ушло — место освобождаем, чтобы повтор не упёрся в «уже отправлено».
    slot.release();
    // Без адреса и пароля: код ошибки и ответ сервера — чтобы понять причину по логу.
    const err = e as { code?: string; responseCode?: number; command?: string };
    console.error(`[mail] письмо ${letter.what} не отправлено: ${[err.code, err.responseCode, err.command].filter(Boolean).join(" ")}`);
    throw new APIError("BAD_GATEWAY", {
      code: "MAIL_FAILED",
      message: "Не получилось отправить письмо. Попробуйте ещё раз через минуту.",
    });
  }
}

/**
 * Письмо со ссылкой для входа; новый адрес по ней же регистрируется (если SIGNUP не
 * closed). ctx — IP клиента и «регистрация ли это» для лимитов (src/lib/auth.ts).
 */
export async function sendLoginLink(email: string, url: string, ctx: MailContext): Promise<void> {
  const href = escapeHtml(url);
  // При SIGNUP=closed новый адрес по ссылке не войдёт — не обещаем ему аккаунт.
  const newcomer = signupClosed ? "" : "Если вы здесь впервые — аккаунт создастся сам.";
  await send(
    email,
    url,
    {
      tag: "login-link",
      what: "со ссылкой входа",
      subject: "Вход в Calo",
      text:
        `Ссылка для входа в Calo (действует 15 минут):\n${url}\n\n` +
        (newcomer ? `${newcomer}\n` : "") +
        "В приложении на iPhone: скопируйте ссылку и вставьте её на экране входа.\n" +
        "Если вы не запрашивали вход — просто удалите письмо.",
      html:
        `<p>Нажмите, чтобы войти в Calo. Ссылка действует 15 минут.${newcomer ? `<br>${newcomer}` : ""}</p>` +
        button(href, "Войти в Calo", "#2438d6") +
        `<p style="color:#8a8c99;font-size:13px">В приложении на iPhone: скопируйте ссылку и вставьте её на экране входа.<br>` +
        `Если вы не запрашивали вход — просто удалите письмо.</p>`,
    },
    ctx,
  );
}

/**
 * Подтверждение удаления аккаунта: ссылка действует час (deleteTokenExpiresIn в auth.ts).
 * Адрес — того, кто вошёл, так что это не регистрация: дневной лимит регистраций его не держит.
 */
export async function sendDeleteAccountLink(email: string, url: string, { ip }: { ip: string | null }): Promise<void> {
  const href = escapeHtml(url);
  await send(
    email,
    url,
    {
      tag: "delete-link",
      what: "об удалении аккаунта",
      subject: "Удаление аккаунта Calo",
      text:
        `Чтобы удалить аккаунт Calo, откройте ссылку (действует 1 час):\n${url}\n\n` +
        "Удалится всё: дневник, продукты, рецепты, вес, цели и настройки. Восстановить их будет нельзя.\n" +
        "Если вы не просили удалить аккаунт — просто удалите письмо, с аккаунтом ничего не случится.",
      html:
        `<p>Вы попросили удалить аккаунт Calo. Ссылка действует 1 час.</p>` +
        `<p>Удалится всё: дневник, продукты, рецепты, вес, цели и настройки. <b>Восстановить их будет нельзя.</b></p>` +
        button(href, "Удалить аккаунт навсегда", "#c62828") +
        `<p style="color:#8a8c99;font-size:13px">Если вы не просили удалить аккаунт — просто удалите письмо, с аккаунтом ничего не случится.</p>`,
    },
    { ip, signup: false },
  );
}
