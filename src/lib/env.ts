import "server-only";

/** Публичный адрес приложения: https://calc.egor.am или http://localhost:3000 */
export const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/** Кому разрешён вход. Пока — только владелец; регистрация закрыта. */
export const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email: string): boolean {
  return allowedEmails.includes(email.trim().toLowerCase());
}
