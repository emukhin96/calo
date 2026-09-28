// Минимальная копия src/lib/auth.ts только для генерации схемы:
//   pnpm auth:schema  →  src/db/schema/auth.ts
// Держать список плагинов в синхроне с src/lib/auth.ts.
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, magicLink } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "pg" }),
  plugins: [magicLink({ sendMagicLink: async () => {} }), passkey(), bearer()],
});
