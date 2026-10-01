import "server-only";
import { passkey } from "@better-auth/passkey";
import { betterAuth, type GenericEndpointContext } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getIP, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { bearer, magicLink } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { DELETED_COOKIE, type DeletedWho } from "./auth-errors";
import { appUrl, signupClosed } from "./env";
import { sendDeleteAccountLink, sendLoginLink } from "./mail";
import { type MailContext, mailLimiter, mailLimitError } from "./mail-limit";

/** Тело POST /sign-in/magic-link до проверки схемы: hooks.before видит его сырым. */
type MagicLinkBody = Partial<Record<"email" | "name" | "callbackURL" | "newUserCallbackURL" | "errorCallbackURL", unknown>>;

const tooLong = (v: unknown, max: number) => typeof v === "string" && v.length > max;

/**
 * better-auth глотает ошибки sendDeleteAccountVerification (runInBackgroundOrAwait)
 * и отвечает «письмо отправлено» — ошибку запоминаем по запросу и отдаём в hooks.after.
 */
const deleteMailErrors = new WeakMap<Request, unknown>();

/**
 * Перед удалением пользователя: recipe_ingredients.food_id без каскада, и свой продукт
 * в своём рецепте не дал бы каскаду снести продукты — сначала рецепты (с составом).
 * Остальное (дневник, продукты, профиль, вес, подписки…) уходит каскадом по owner_id.
 */
async function deleteOwnRecipes(userId: string) {
  await db.delete(schema.recipes).where(eq(schema.recipes.ownerId, userId));
}

/**
 * IP клиента для лимитов писем — тем же getIP, что у ограничителя better-auth:
 * x-forwarded-for, только если в нём один адрес (Caddy ставит туда адрес клиента сам,
 * присланный клиентом заголовок заменяет), IPv6 — до /64. Нет заголовка — null
 * (в dev и тестах — 127.0.0.1). advanced.ipAddress у нас не задан; если появится —
 * передать его и сюда.
 */
const clientIp = (req: Request | Headers | undefined): string | null => (req ? getIP(req, {}) : null);

/**
 * Для лимитов письма входа: IP и «регистрация ли это» — адрес без аккаунта (их держит
 * дневной лимит). hooks.before и sendMagicLink считают одинаково: что проверка
 * пропустила, то и займёт место, а отказ не оставит строки в verification. Это для
 * запросов по очереди; из параллельных проверку пройдут все, место займёт один, а у
 * остальных строка останется — токен в ней хеширован, живёт 15 минут, её убирает cron.
 */
async function loginMailContext(
  ctx: Pick<GenericEndpointContext, "request" | "headers" | "context"> | undefined,
  email: string,
): Promise<MailContext> {
  return {
    ip: clientIp(ctx?.request ?? ctx?.headers),
    // Без контекста не проверить — считаем регистрацией: лишний раз упрёмся в лимит, но не обойдём его.
    signup: ctx ? !(await ctx.context.internalAdapter.findUserByEmail(email)) : true,
  };
}

export const auth = betterAuth({
  appName: "Calo",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  session: {
    expiresIn: 60 * 60 * 24 * 90, // 90 дней: приложение живёт на телефоне
    updateAge: 60 * 60 * 24,
  },
  user: {
    deleteUser: {
      enabled: true,
      // Ссылка из письма действует час. Ведёт она не на удаление, а на страницу
      // подтверждения (src/app/delete-account): почтовые сканеры сами открывают ссылки
      // из писем, а удаление необратимо. Кнопка там — /delete-user/callback в hooks.before.
      deleteTokenExpiresIn: 60 * 60,
      beforeDelete: (user) => deleteOwnRecipes(user.id),
      async sendDeleteAccountVerification({ user, token }, request) {
        try {
          await sendDeleteAccountLink(user.email, `${appUrl}/delete-account?token=${encodeURIComponent(token)}`, {
            ip: clientIp(request),
          });
        } catch (e) {
          if (!request) throw e;
          deleteMailErrors.set(request, e);
        }
      },
    },
  },
  plugins: [
    // Первый вход, регистрация и запасной вариант — ссылка на email.
    magicLink({
      expiresIn: 60 * 15,
      // Утёкшая таблица verification не даёт войти: в базе только хеш токена.
      storeToken: "hashed",
      disableSignUp: signupClosed,
      async sendMagicLink({ email, url }, ctx) {
        await sendLoginLink(email, url, await loginMailContext(ctx, email));
      },
    }),
    // Основной вход на телефоне — Face ID / Touch ID.
    passkey({
      rpID: new URL(appUrl).hostname,
      rpName: "Calo",
      origin: appUrl,
    }),
    // Authorization: Bearer <token> — для нативного приложения и виджета.
    bearer(),
    nextCookies(), // должен быть последним
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/magic-link") {
        // До обработчика: раздутое тело и запрос сверх лимита писем не должны оставлять строк в verification.
        const body = (ctx.body ?? {}) as MagicLinkBody;
        if (
          tooLong(body.email, 254) ||
          tooLong(body.name, 100) ||
          tooLong(body.callbackURL, 200) ||
          tooLong(body.newUserCallbackURL, 200) ||
          tooLong(body.errorCallbackURL, 200)
        ) {
          throw new APIError("BAD_REQUEST", { message: "Слишком длинный адрес или имя" });
        }
        if (typeof body.email === "string") {
          const r = mailLimiter.check(body.email, "login-link", await loginMailContext(ctx, body.email));
          if (!r.ok) throw mailLimitError(r);
        }
        return;
      }
      if (ctx.path === "/delete-user/callback") {
        // Штатный обработчик требует сессию в том же браузере, а ссылку из письма
        // открывают в Safari, когда вошли в приложении или в PWA (у них свои cookie), —
        // и получают 404 в JSON. Токен из письма доказывает владение ящиком так же,
        // как ссылка входа, поэтому удаляем по нему, без сессии.
        const token = typeof ctx.query?.token === "string" ? ctx.query.token : "";
        const row = token ? await ctx.context.internalAdapter.consumeVerificationValue(`delete-account-${token}`) : null;
        if (!row) throw ctx.redirect(`${appUrl}/login?error=DELETE_LINK_INVALID`);
        const current = await getSessionFromCtx(ctx);
        await deleteOwnRecipes(row.value);
        await ctx.context.internalAdapter.deleteUser(row.value); // сессии, аккаунты, пользователь
        if (current?.user.id === row.value) deleteSessionCookie(ctx);
        // ?deleted=1 подделает кто угодно, а /login по нему стирает данные на устройстве —
        // поэтому чей аккаунт удалён, говорит cookie (src/app/login/page.tsx). self — вход
        // этого браузера: уборка нужна; other — входа нет или вошёл другой: только сообщение.
        // Без входа уборку не запускаем: свою ссылку удаления (аккаунт-однодневку) может
        // прислать кто угодно, а за истёкшим входом уберёт OwnerGuard при следующем входе.
        // Живёт 2 минуты и только для /login.
        const who: DeletedWho = current?.user.id === row.value ? "self" : "other";
        ctx.setCookie(DELETED_COOKIE, who, {
          maxAge: 120,
          path: "/login",
          httpOnly: true,
          sameSite: "lax",
          secure: appUrl.startsWith("https://"),
        });
        throw ctx.redirect(`${appUrl}/login?deleted=1`);
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/delete-user" || !ctx.request) return;
      const e = deleteMailErrors.get(ctx.request);
      if (e) throw e;
    }),
  },
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          // Вход по ссылке создаёт пользователя с пустым именем, а passkey показывает
          // user.name как имя учётной записи в Face ID — пусть там будет адрес.
          return { data: { ...user, name: user.name?.trim() || user.email } };
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
