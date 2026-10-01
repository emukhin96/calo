// Тексты и проверки раздела «Аккаунт» в настройках: выход и удаление аккаунта.
// Чистые функции — без React и сети.
import { plural } from "@/domain/text";

/** Предупреждение перед выходом, если офлайн-очередь не пуста; null — очередь пуста. */
export function unsentWarning(count: number): string | null {
  if (count <= 0) return null;
  const unsent = plural(count, ["запись ещё не отправлена", "записи ещё не отправлены", "записей ещё не отправлены"]);
  const lost = plural(count, ["она пропадёт", "они пропадут", "они пропадут"]);
  return `${count} ${unsent} — при выходе ${lost}.`;
}

/** Ошибка из ответа better-auth: { error: { status, code?, message? } }. */
type AuthError = { status?: number; code?: string; message?: string };

/**
 * Текст ошибки «Удалить аккаунт» (письмо с подтверждением не ушло). error — объект
 * ошибки из ответа или то, что бросил вызов (нет сети — better-auth бросает).
 */
export function deleteAccountErrorText(error: unknown): string {
  if (typeof error !== "object" || error === null || typeof (error as AuthError).status !== "number") {
    return "Нет связи с сервером. Проверьте интернет и попробуйте снова.";
  }
  const { status, message } = error as AuthError;
  // Русский текст (EMAIL_THROTTLED, MAIL_FAILED…) пишет только наш сервер — он точнее
  // запасного; английский — от better-auth, его не показываем.
  if (message && /[а-яё]/i.test(message)) return message;
  if (status === 429) return "Слишком много попыток. Подождите минуту и попробуйте снова.";
  if (status === 401) return "Сессия истекла. Войдите заново и повторите.";
  return "Не получилось отправить письмо. Попробуйте ещё раз через минуту.";
}

/** Ссылка из письма об удалении действует час (deleteTokenExpiresIn в lib/auth). */
const DELETE_LINK_TTL_MS = 60 * 60_000;

/**
 * Куда вернуться, если «Да, удалить» не отправило письмо. При 429 ссылка часто уже
 * в ящике: сервер так и говорит (EMAIL_THROTTLED — письмо об удалении на этот адрес
 * ушло меньше часа назад, с любого устройства) или мы сами отправили его не позже
 * часа назад (sentAt). Тогда — «Письмо отправлено»: только там поле, куда в приложении
 * вставляют ссылку. Иначе — снова «Удалить аккаунт?» с кнопкой повтора.
 */
export function deleteStateAfterError(error: unknown, sentAt: number | null, now: number): "sent" | "confirm" {
  const { status, code } = (typeof error === "object" && error !== null ? error : {}) as AuthError;
  if (status !== 429) return "confirm";
  if (code === "EMAIL_THROTTLED") return "sent";
  return sentAt !== null && now - sentAt < DELETE_LINK_TTL_MS ? "sent" : "confirm";
}

/**
 * Ссылка из письма об удалении, вставленная в приложении или в Calo с экрана «Домой».
 * Из письма она откроется в Safari: аккаунт удалится, но здесь об этом не узнают —
 * останутся офлайн-очередь и кэши, а в приложении виджет и «Здоровье». Открытая здесь
 * (страница подтверждения → кнопка), она приведёт на /login?deleted=1 в этом же окне,
 * и оно уберёт за собой (lib/sign-out).
 * Возвращает адрес для перехода или null, если это не наша ссылка.
 */
export function deleteLinkFrom(pasted: string, origin: string): string | null {
  try {
    const url = new URL(pasted.trim());
    // Письмо ведёт на страницу подтверждения; прямой адрес кнопки с неё — тоже годится.
    const path = url.pathname.replace(/\/$/, "");
    if (url.origin !== origin || !["/delete-account", "/api/auth/delete-user/callback"].includes(path) || !url.searchParams.get("token")) return null;
    return url.href;
  } catch {
    return null;
  }
}
