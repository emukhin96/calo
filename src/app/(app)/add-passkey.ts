// Тексты баннера «Включите вход по Face ID» (AddPasskeyBanner). Чистые функции — без React и сети.

/**
 * Коды отказа WebAuthn, за которыми обычно стоит сам человек: закрыл окно Face ID или
 * не успел. @better-auth/passkey отдаёт только code и message от @simplewebauthn/browser
 * (имя DOMException теряется): AbortError → ERROR_CEREMONY_ABORTED, NotAllowedError
 * (отмена, тайм-аут, «не разрешено» — браузеры их не различают) →
 * ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY.
 */
const CANCEL_CODES = new Set(["ERROR_CEREMONY_ABORTED", "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"]);

/** Ошибка из ответа better-auth: { error: { status, code?, message? } }. */
type AuthError = { status?: number; code?: string; message?: string };

/** Текст ошибки «Включить»; null — молчим: окно закрыли сами, баннер остаётся, можно нажать ещё раз. */
export function addPasskeyErrorText(error: AuthError | null | undefined): string | null {
  const code = error?.code;
  if (code && CANCEL_CODES.has(code)) return null;
  // Добавить passkey better-auth даёт только в первые сутки после входа (freshAge).
  if (code === "SESSION_NOT_FRESH") return "Чтобы включить Face ID, войдите заново по ссылке из письма.";
  return "Не получилось включить Face ID. Попробуйте ещё раз.";
}
