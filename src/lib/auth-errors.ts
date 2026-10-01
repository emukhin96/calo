// Тексты ошибок входа для экрана /login: ответ POST /api/auth/sign-in/magic-link
// и ?error= после перехода по ссылке из письма; и разбор ?deleted=. Чистые функции —
// без React и сети.

/** Ошибка из ответа better-auth: { error: { status, code?, message? } }. */
export type AuthErrorLike = { status: number; code?: string; message?: string };

const isAuthError = (e: unknown): e is AuthErrorLike =>
  typeof e === "object" && e !== null && typeof (e as { status?: unknown }).status === "number";

const hasOwn = <T extends object>(map: T, key: string): key is Extract<keyof T, string> => Object.hasOwn(map, key);

// Наши коды (src/lib/auth.ts). Сервер присылает к ним русский текст — точнее этих
// запасных (например, когда можно запросить следующее письмо); эти — если текста нет.
const MAIL_ERRORS = {
  EMAIL_THROTTLED: "Письмо уже отправлено. Новое можно запросить чуть позже.",
  MAIL_IP_DAILY_CAP: "Слишком много писем с этого адреса сети за сутки. Попробуйте завтра.",
  // Держит только регистрации — у тех, кто уже есть, письма идут; Face ID у новичка нет.
  MAIL_DAILY_CAP: "Регистрация новых пользователей на сегодня приостановлена. Попробуйте завтра.",
  MAIL_FAILED: "Не получилось отправить письмо. Попробуйте ещё раз через минуту.",
};

/**
 * Текст ошибки «Прислать ссылку». error — объект ошибки из ответа или то, что бросил
 * вызов: без ответа сервера (нет сети, сервер лёг) better-auth не возвращает, а бросает.
 */
export function signInErrorText(error: unknown): string {
  if (!isAuthError(error)) return "Нет связи с сервером. Проверьте интернет и попробуйте снова.";
  const { status, code, message } = error;
  // Русский текст пишет только наш сервер; английский — от better-auth, его не показываем.
  if (message && /[а-яё]/i.test(message)) return message;
  if (code && hasOwn(MAIL_ERRORS, code)) return MAIL_ERRORS[code];
  // 429 без нашего кода — ограничитель better-auth по IP.
  if (status === 429) return "Слишком много попыток. Подождите минуту и попробуйте снова.";
  if (status === 400) return "Проверьте адрес почты.";
  return "Не получилось отправить ссылку. Попробуйте ещё раз.";
}

// Коды better-auth при переходе по ссылке (magic-link/verify) и наши. Остальные —
// failed_to_create_user, failed_to_create_session, user_not_found и незнакомые —
// общим текстом: пользователю тут нечего исправлять, кроме как запросить ссылку заново.
const LINK_ERRORS = {
  INVALID_TOKEN: "Ссылка устарела или уже использована — запросите новую.",
  new_user_signup_disabled: "Регистрация временно закрыта. Попробуйте позже.",
  // Наш: ссылка из письма об удалении (src/lib/auth.ts, /delete-user/callback). Не
  // «аккаунт не удалён»: ссылку могли уже открыть, и тогда он как раз удалён.
  DELETE_LINK_INVALID:
    "Ссылка на удаление устарела или уже использована. Если аккаунт ещё есть — запросите удаление заново в Профиле.",
};

/**
 * Текст для ?error= на /login; null — ошибки нет. error_description из адреса
 * не показываем никогда: его может подставить кто угодно, прислав ссылку на /login.
 */
export function callbackErrorText(code: string | string[] | null | undefined): string | null {
  const c = Array.isArray(code) ? code[0] : code;
  if (!c) return null;
  return hasOwn(LINK_ERRORS, c) ? LINK_ERRORS[c] : "Не получилось войти по ссылке. Запросите новую и попробуйте ещё раз.";
}

/**
 * Cookie после удаления аккаунта по ссылке (ставит /delete-user/callback в auth.ts):
 * self — удалён аккаунт этого браузера или входа здесь не было, other — здесь вошёл другой.
 */
export const DELETED_COOKIE = "calo.deleted";
export type DeletedWho = "self" | "other";

/**
 * ?deleted=1 на /login: само по себе — ничего, ссылку на /login?deleted=1 может прислать
 * кто угодно, а по ней стираются данные на устройстве. Верим только вместе с cookie
 * от сервера. null — ни сообщения, ни уборки.
 */
export function deletedFrom(param: string | string[] | null | undefined, cookie: string | null | undefined): DeletedWho | null {
  const p = Array.isArray(param) ? param[0] : param;
  if (p !== "1") return null;
  return cookie === "self" || cookie === "other" ? cookie : null;
}
