import "server-only";
import nodemailer from "nodemailer";

/**
 * Письмо со ссылкой для входа. SMTP_URL (smtps://user:pass@host:465) и
 * MAIL_FROM задаются в .env на сервере. Пока SMTP не настроен, ссылка пишется
 * в лог контейнера — её достаёт deploy/vps/login-link.sh.
 */
export async function sendLoginLink(email: string, url: string): Promise<void> {
  const smtp = process.env.SMTP_URL;
  if (!smtp) {
    console.log(`[login-link] ${email} ${url}`);
    return;
  }
  await nodemailer.createTransport(smtp).sendMail({
    from: process.env.MAIL_FROM ?? "Calo <no-reply@egor.am>",
    to: email,
    subject: "Вход в Calo",
    text: `Ссылка для входа (действует 15 минут):\n${url}`,
    html: `<p>Ссылка для входа в Calo (действует 15 минут):</p><p><a href="${url}">Войти</a></p>`,
  });
}
