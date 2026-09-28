import "server-only";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { bearer, magicLink } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { appUrl, isEmailAllowed } from "./env";
import { sendLoginLink } from "./mail";

export const auth = betterAuth({
  appName: "Calo",
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  session: {
    expiresIn: 60 * 60 * 24 * 90, // 90 дней: это личное приложение на телефоне
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    // Первый вход и запасной вариант — ссылка на email.
    magicLink({
      expiresIn: 60 * 15,
      async sendMagicLink({ email, url }) {
        // Чужим адресам молча ничего не отправляем: не раскрываем, кто есть в списке.
        if (!isEmailAllowed(email)) return;
        await sendLoginLink(email, url);
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
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          if (!isEmailAllowed(user.email)) {
            throw new APIError("FORBIDDEN", { message: "Регистрация закрыта" });
          }
          return { data: user };
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
