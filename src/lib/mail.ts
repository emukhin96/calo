import "server-only";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

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

/**
 * Письмо со ссылкой для входа. SMTP_URL и MAIL_FROM задаются в .env на сервере
 * (scripts/set-smtp.command). Пока SMTP не настроен, ссылка пишется в лог
 * контейнера — её достаёт deploy/vps/login-link.sh.
 */
export async function sendLoginLink(email: string, url: string): Promise<void> {
  const smtp = process.env.SMTP_URL;
  if (!smtp) {
    console.log(`[login-link] ${email} ${url}`);
    return;
  }
  const href = escapeHtml(url);
  try {
    await nodemailer.createTransport(smtpOptions(smtp)).sendMail({
      from: process.env.MAIL_FROM || "Calo <no-reply@egor.am>",
      to: email,
      subject: "Вход в Calo",
      text:
        `Ссылка для входа в Calo (действует 15 минут):\n${url}\n\n` +
        "В приложении на iPhone: скопируйте ссылку и вставьте её на экране входа.\n" +
        "Если вы не запрашивали вход — просто удалите письмо.",
      html:
        `<p>Нажмите, чтобы войти в Calo. Ссылка действует 15 минут.</p>` +
        `<p><a href="${href}" style="display:inline-block;padding:12px 22px;border-radius:14px;background:#2438d6;color:#ffffff;text-decoration:none;font-weight:bold">Войти в Calo</a></p>` +
        `<p style="color:#8a8c99;font-size:13px">В приложении на iPhone: скопируйте ссылку и вставьте её на экране входа.<br>` +
        `Если вы не запрашивали вход — просто удалите письмо.</p>`,
    });
  } catch (e) {
    // Без адреса и пароля: код ошибки и ответ сервера — чтобы понять причину по логу.
    const err = e as { code?: string; responseCode?: number; command?: string };
    console.error(`[mail] письмо со ссылкой входа не отправлено: ${[err.code, err.responseCode, err.command].filter(Boolean).join(" ")}`);
    throw e;
  }
}
