import "server-only";

/** Публичный адрес приложения: https://calc.egor.am или http://localhost:3000 */
export const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/**
 * Владелец (через запятую): ему не мешает общий дневной лимит ИИ. Вход открыт всем,
 * так что это уже не список допуска. Старое имя ALLOWED_EMAILS читается, пока .env
 * на сервере не переписан.
 */
export const ownerEmails = (process.env.OWNER_EMAILS || process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isOwnerEmail(email: string): boolean {
  return ownerEmails.includes(email.trim().toLowerCase());
}

/** SIGNUP=closed — аварийно закрыть регистрацию: войти смогут только те, кто уже есть. */
export const signupClosed = process.env.SIGNUP?.trim().toLowerCase() === "closed";
